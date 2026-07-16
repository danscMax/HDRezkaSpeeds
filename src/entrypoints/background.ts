/**
 * MV3 service worker.
 *
 * Three jobs (all event-driven, no persistent state):
 *
 * 1. Install hook — opens welcome.html exactly once when the user clicks
 *    "Add to Chrome" (reason='install'); updates are ignored for the tab
 *    but DO trigger a mirror-script reconcile (see below).
 *
 * 2. open-extension-page proxy — content scripts can't window.open
 *    chrome-extension:// URLs (page origin is the initiator and the
 *    target isn't web-accessible), so the in-player Settings CTA routes
 *    through here. Strict path allow-list.
 *
 * 3. User-mirror registration owner. Users add their own HDRezka mirror
 *    hosts (storage/mirrors-store.ts); this worker is the ONLY writer of
 *    the matching `scripting.registerContentScripts` registration: one
 *    dynamic script (id 'user-mirrors') whose `matches` is the union of
 *    all user hosts that currently hold a granted host permission.
 *    Reconcile triggers:
 *      - storage.onChanged on the mirrors key (popup/player edits; also
 *        revokes the origin permission for hosts removed from the list),
 *      - permissions.onAdded/onRemoved (grants from the popup, revokes
 *        from browser UI),
 *      - runtime.onInstalled (Chrome wipes dynamic scripts on extension
 *        update; persistAcrossSessions only survives browser restarts),
 *      - runtime.onStartup (belt-and-suspenders for the FF session edge).
 *    Runs are serialized through a promise chain — interleaved
 *    register/unregister calls throw "Duplicate script ID".
 */

import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { storageKeysFor } from '../config';
import { builtinMatchPatterns, BUILTIN_MIRROR_HOSTS, originPatternsFor } from '../sites/mirror-hosts';
import { createBrowserStorageAdapter } from '../storage/adapter';
import { MIRRORS_STORAGE_KEY, readUserMirrors, sanitizeMirrorList } from '../storage/mirrors-store';

/** Single dynamic-registration id covering ALL user mirrors. */
const DYNAMIC_SCRIPT_ID = 'user-mirrors';

/** Dynamic-registration id for the opt-in broad "auto-follow" script. */
const AUTO_FOLLOW_SCRIPT_ID = 'auto-follow';
/** Broad match / origin backing auto-follow (single source of truth). */
const BROAD_ORIGIN = '*://*/*';
/** Settings blob key — read to learn whether auto-follow is opted in. */
const SETTINGS_STORAGE_KEY = storageKeysFor('hdrezka').settings;

/**
 * Built output path of the content entrypoint (same file the manifest
 * registration uses) — WXT emits it identically for chrome-mv3 and
 * firefox-mv3, verified in the generated manifests of both targets.
 */
const CONTENT_SCRIPT_FILE = 'content-scripts/content.js';

export default defineBackground(() => {
  const adapter = createBrowserStorageAdapter();

  function hasOriginPermission(host: string): Promise<boolean> {
    // Both patterns requested atomically on grant, so AND-semantics of
    // `contains` is what we want: a partial external revoke flips the
    // whole host to "no access" (conservative, matches the UI badge).
    return browser.permissions.contains({ origins: originPatternsFor(host) });
  }

  async function reconcileMirrorScripts(): Promise<void> {
    const hosts = await readUserMirrors(adapter);
    const granted = await Promise.all(hosts.map((h) => hasOriginPermission(h)));
    const matches = hosts.filter((_, i) => granted[i]).flatMap((h) => originPatternsFor(h));

    const existing = await browser.scripting.getRegisteredContentScripts({
      ids: [DYNAMIC_SCRIPT_ID],
    });

    if (matches.length === 0) {
      if (existing.length > 0) {
        await browser.scripting.unregisterContentScripts({ ids: [DYNAMIC_SCRIPT_ID] });
      }
      return;
    }

    const script = {
      id: DYNAMIC_SCRIPT_ID,
      js: [CONTENT_SCRIPT_FILE],
      matches,
      runAt: 'document_idle' as const,
      allFrames: false,
      // Survives browser restarts; extension updates still wipe it,
      // hence the onInstalled reconcile.
      persistAcrossSessions: true,
    };

    if (existing.length > 0) {
      await browser.scripting.updateContentScripts([script]);
    } else {
      await browser.scripting.registerContentScripts([script]);
    }
  }

  /**
   * Register/unregister the broad auto-follow content script. Active only
   * when the user opted in AND granted the broad host permission — the same
   * self-bailing content.js runs everywhere and exits on non-HDRezka pages
   * via looksLikeHDRezka(). Independent of the user-mirrors registration.
   */
  async function reconcileAutoFollowScript(): Promise<void> {
    const blob = await adapter.get<Record<string, unknown> | null>(SETTINGS_STORAGE_KEY, null);
    const enabled = !!(blob && typeof blob === 'object' && blob.autoFollowMirrors === true);
    const hasBroad = await browser.permissions.contains({ origins: [BROAD_ORIGIN] });

    // Broad permission revoked from the browser UI while the flag is still on
    // — the toggle would keep showing "on" but auto-follow is dead. Reset the
    // flag so the popup reflects reality (this write's storage.onChanged
    // refreshes the UI; the re-entrant reconcile is a no-op once enabled=false).
    if (enabled && !hasBroad && blob) {
      await adapter.set(SETTINGS_STORAGE_KEY, { ...blob, autoFollowMirrors: false });
    }

    const wantActive = enabled && hasBroad;
    const existing = await browser.scripting.getRegisteredContentScripts({
      ids: [AUTO_FOLLOW_SCRIPT_ID],
    });

    if (!wantActive) {
      if (existing.length > 0) {
        await browser.scripting.unregisterContentScripts({ ids: [AUTO_FOLLOW_SCRIPT_ID] });
      }
      return;
    }

    // Exclude hosts already covered by the static manifest registration
    // (built-in mirrors) and the user-mirrors dynamic script, so a rezka host
    // isn't matched twice. The boot guard blocks a second bootstrap, but the
    // broad script would otherwise still parse content.js again and re-add
    // top-level listeners on the happy path.
    const userHosts = await readUserMirrors(adapter);
    const excludeMatches = [
      ...builtinMatchPatterns(),
      ...userHosts.flatMap((h) => originPatternsFor(h)),
    ];

    const script = {
      id: AUTO_FOLLOW_SCRIPT_ID,
      js: [CONTENT_SCRIPT_FILE],
      matches: [BROAD_ORIGIN],
      excludeMatches,
      runAt: 'document_idle' as const,
      allFrames: false,
      persistAcrossSessions: true,
    };

    if (existing.length > 0) {
      await browser.scripting.updateContentScripts([script]);
    } else {
      await browser.scripting.registerContentScripts([script]);
    }
  }

  /** Both dynamic registrations reconciled together (idempotent). */
  async function reconcileAll(): Promise<void> {
    await reconcileMirrorScripts();
    await reconcileAutoFollowScript();
  }

  // Serialize reconciles: storage.onChanged + permissions.onAdded fire
  // back-to-back for a single popup "add" / toggle and must not interleave.
  let reconcileChain: Promise<void> = Promise.resolve();
  function scheduleReconcile(reason: string): void {
    reconcileChain = reconcileChain.then(reconcileAll).catch((e: unknown) => {
      console.warn('[HDREZKA-SPEEDS] mirror reconcile failed (%s)', reason, e);
    });
  }

  /** Per-host granted map for the Mirrors tab (popup + in-player). */
  async function getMirrorStatus(): Promise<{
    ok: true;
    status: Record<string, boolean>;
    builtinStatus: Record<string, boolean>;
  }> {
    const hosts = await readUserMirrors(adapter);
    const status: Record<string, boolean> = {};
    const builtinStatus: Record<string, boolean> = {};
    await Promise.all([
      ...hosts.map(async (h) => {
        status[h] = await hasOriginPermission(h);
      }),
      // Built-ins too: Firefox does NOT auto-grant host permissions added
      // by an extension UPDATE (bug 1893232), so e.g. standby-rezka.tv can
      // be silently non-granted for updated FF profiles. The popup shows
      // the same re-grant button for those.
      ...BUILTIN_MIRROR_HOSTS.map(async (h) => {
        builtinStatus[h] = await hasOriginPermission(h);
      }),
    ]);
    return { ok: true, status, builtinStatus };
  }

  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install') {
      const url = browser.runtime.getURL('/welcome.html');
      void browser.tabs.create({ url });
    }
    // Chrome clears dynamic content scripts on every extension update —
    // re-register from storage without waiting for user action.
    scheduleReconcile(`installed:${reason}`);
  });

  browser.runtime.onStartup.addListener(() => {
    scheduleReconcile('startup');
  });

  browser.permissions.onAdded.addListener(() => {
    scheduleReconcile('permission-added');
  });
  browser.permissions.onRemoved.addListener(() => {
    scheduleReconcile('permission-removed');
  });

  browser.storage.local.onChanged.addListener((changes) => {
    const mirrorChange = changes[MIRRORS_STORAGE_KEY];
    if (mirrorChange) {
      const before = sanitizeMirrorList(mirrorChange.oldValue);
      const after = sanitizeMirrorList(mirrorChange.newValue);
      // Hosts dropped from the list lose their origin permission too —
      // we requested it, we clean it up. (User hosts are never covered by
      // required host_permissions: mirrors-store rejects built-in dupes.)
      for (const host of before.filter((h) => !after.includes(h))) {
        browser.permissions.remove({ origins: originPatternsFor(host) }).catch(() => {
          // Not granted / not removable — nothing to clean up.
        });
      }
    }

    // Auto-follow toggle lives in the settings blob, which is rewritten on
    // every minor settings edit — only reconcile when the flag itself flips,
    // otherwise a theme/preset write would churn the registration.
    const settingsChange = changes[SETTINGS_STORAGE_KEY];
    let autoFollowFlipped = false;
    if (settingsChange) {
      const was =
        (settingsChange.oldValue as { autoFollowMirrors?: unknown } | undefined)
          ?.autoFollowMirrors === true;
      const now =
        (settingsChange.newValue as { autoFollowMirrors?: unknown } | undefined)
          ?.autoFollowMirrors === true;
      autoFollowFlipped = was !== now;
    }

    if (mirrorChange || autoFollowFlipped) {
      scheduleReconcile('storage-change');
    }
  });

  // Audit 2026-05-11: open-extension-page proxy. Content scripts can't
  // navigate to chrome-extension:// URLs via window.open — the page's
  // own `window` (origin hdrezka.ag / rezka.ag / etc.) is treated as
  // the initiator and the target is not in `web_accessible_resources`,
  // so the browser silently drops the open. Routing through the
  // background SW works because the SW owns chrome.tabs and is
  // allowed to create tabs at extension URLs without the `tabs`
  // permission. Reachable from the in-player Settings → feedback CTA.
  // Strict allow-list of paths the proxy will open. WXT's getURL is
  // statically typed to known public paths, so we narrow on the wire
  // before resolving.
  const ALLOWED_PAGES = new Set(['/feedback.html', '/welcome.html']);
  browser.runtime.onMessage.addListener((msg: unknown, sender): Promise<unknown> | undefined => {
    if (!msg || typeof msg !== 'object') return undefined;
    const m = msg as { type?: unknown; path?: unknown };
    if (m.type === 'mirrors:get-status') {
      return getMirrorStatus().catch((e: unknown) => ({ ok: false, error: String(e) }));
    }
    if (m.type !== 'open-extension-page') return undefined;
    if (typeof m.path !== 'string' || !ALLOWED_PAGES.has(m.path)) {
      return Promise.resolve({ ok: false, error: 'invalid_path' });
    }
    const url = browser.runtime.getURL(m.path as '/feedback.html' | '/welcome.html');
    void sender;
    return browser.tabs
      .create({ url })
      .then(() => ({ ok: true }))
      .catch((e: unknown) => ({ ok: false, error: String(e) }));
  });
});
