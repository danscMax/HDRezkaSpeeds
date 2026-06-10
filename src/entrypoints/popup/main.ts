/**
 * Popup entrypoint -- mirrors the in-player gear-menu so the user can
 * tweak settings without opening a video.
 *
 * Architecture:
 *   - Inspect the active tab via browser.tabs.query (no broad `tabs`
 *     permission needed; URL access uses the activeTab grant from the
 *     toolbar click). Audit H9.
 *   - Build a popup-flavoured AppContext: real SettingsStore + SpeedStore
 *     reading the same browser.storage.local the content script writes,
 *     no UiPort/discovery (no video here), no panel.
 *   - Render the SAME settings modal template via renderSettingsMenu, but
 *     the diagnostics tab swaps in a "view diagnostics in the player"
 *     hint because there's no video / health-checker context here.
 *   - The popup ALWAYS bootstraps (Site is a single-member union): on an
 *     unsupported tab it opens straight on the Mirrors tab so the user
 *     can add the site they're looking at as a mirror. The popup is also
 *     the only surface that can grant host permissions (0.5.0) — the
 *     in-player menu manages the mirror list but can't call
 *     permissions.request from a content script.
 */

import { browser } from 'wxt/browser';
import { CleanupRegistry } from '../../app/cleanup';
import type { AppContext } from '../../app/context';
import type { DiagnosticsPort, DiscoveryPort, Site, UiPort } from '../../app/ports';
import { storageKeysFor } from '../../config';
import type { DiagnosticReport } from '../../health/types';
import { createTranslator } from '../../i18n/translator';
import { detectSite } from '../../sites/detect';
import {
  BUILTIN_MIRROR_HOSTS,
  isCoveredByHostList,
  originPatternsFor,
} from '../../sites/mirror-hosts';
import { createBrowserStorageAdapter } from '../../storage/adapter';
import {
  addUserMirror,
  MAX_USER_MIRRORS,
  MIRRORS_STORAGE_KEY,
  normalizeMirrorInput,
  readUserMirrors,
  removeUserMirror,
  replaceUserMirrors,
} from '../../storage/mirrors-store';
import { createSettingsStore } from '../../storage/settings-store';
import { createSpeedStore } from '../../storage/speed-store';
import {
  type ActiveTab,
  attachSettingsHandlers,
  injectStyles,
  renderSettingsMenu,
  showNotification,
} from '../../ui';
import { h } from '../../ui/dom-h';
import type { MirrorsViewModel } from '../../ui/settings/modal';
import { createLogger } from '../../utils/logger';

declare const __VS_VERSION__: string | undefined;
const SCRIPT_VERSION = typeof __VS_VERSION__ === 'string' ? __VS_VERSION__ : '0.1.0';

console.info('[HDREZKA-SPEEDS] popup loaded');

const root = document.getElementById('app');
if (root) {
  // Set a temporary dark theme on <html> so the synchronous skeleton
  // never flashes light before async storage read settles. The async
  // path below overrides with the persisted lastSeenTheme as soon as
  // it's available.
  document.documentElement.dataset.vsTheme = 'dark';
  renderInitialShell(root);
  void bootstrapPopup(root).catch((e) => {
    console.error('[HDREZKA-SPEEDS] popup bootstrap failed', e);
    root.replaceChildren(
      h(
        'div',
        { class: 'vs-popup-empty' },
        h('span', { class: 'vs-popup-empty-title' }, 'Failed to load'),
        ' ',
        String(e?.message ?? e),
      ),
    );
  });
}

/**
 * Synchronous skeleton — same outer shape as the final settings menu so
 * the popup window size is correct before any async work completes.
 * Translator hasn't loaded yet, so labels are language-neutral
 * placeholders that get replaced by the real menu in milliseconds.
 */
function renderInitialShell(host: HTMLElement): void {
  host.replaceChildren(
    h(
      'div',
      { class: 'settings-menu vs-popup-skeleton' },
      h('div', { class: 'vs-skel-header' }, h('div', { class: 'vs-skel-line vs-skel-w-60' })),
      h(
        'div',
        { class: 'vs-skel-tabs' },
        h('div', { class: 'vs-skel-pill' }),
        h('div', { class: 'vs-skel-pill' }),
        h('div', { class: 'vs-skel-pill' }),
        h('div', { class: 'vs-skel-pill' }),
        h('div', { class: 'vs-skel-pill' }),
      ),
      h(
        'div',
        { class: 'vs-skel-body' },
        h('div', { class: 'vs-skel-line vs-skel-w-40' }),
        h('div', { class: 'vs-skel-block' }),
        h('div', { class: 'vs-skel-line vs-skel-w-40' }),
        h('div', { class: 'vs-skel-block' }),
        h('div', { class: 'vs-skel-line vs-skel-w-40' }),
        h('div', { class: 'vs-skel-row' }),
        h('div', { class: 'vs-skel-row' }),
      ),
    ),
  );
}

async function bootstrapPopup(host: HTMLElement): Promise<void> {
  // 1. Inspect the active tab. activeTab grant from the toolbar click
  //    gives us URL access for THIS click only. Site is a single-member
  //    union ('hdrezka'), so the popup always bootstraps with it — the
  //    tab info only decides the initial tab (Mirrors on unsupported
  //    hosts) and the "Add current site" CTA.
  const activeTabInfo = await detectActiveTab();
  const site: Site = 'hdrezka';

  // Tag <html> with the site so the cascading menu styles (active pills,
  // toggles, segmented control) use the per-site accent. Mirrors the
  // in-player .vs-panel [data-vs-site] approach.
  document.documentElement.dataset.vsSite = site;

  // 2. Build the popup-flavoured context.
  const adapter = createBrowserStorageAdapter();
  const settingsStore = createSettingsStore(adapter);
  const speedStore = createSpeedStore(adapter);
  await settingsStore.init(site);
  await speedStore.init(site);

  // 2a. User-mirrors view model. The popup owns permission management:
  //     status is read directly via browser.permissions (no background
  //     round-trip needed in an extension page).
  let mirrorsVm: MirrorsViewModel = {
    builtinHosts: BUILTIN_MIRROR_HOSTS,
    userHosts: [],
    status: {},
    builtinStatus: {},
    canManagePermissions: true,
    maxMirrors: MAX_USER_MIRRORS,
  };

  function hasOriginPermission(hostName: string): Promise<boolean> {
    return browser.permissions
      .contains({ origins: originPatternsFor(hostName) })
      .catch(() => false);
  }

  function requestOriginPermission(hostName: string): Promise<boolean> {
    return browser.permissions
      .request({ origins: originPatternsFor(hostName) })
      .catch((e: unknown) => {
        console.warn('[HDREZKA-POPUP] permissions.request failed', e);
        return false;
      });
  }

  /** "Add current site" CTA state, derived from the active tab + list. */
  function computeCurrentHost(
    userHosts: readonly string[],
    status: Record<string, boolean>,
  ): MirrorsViewModel['currentHost'] {
    if (!activeTabInfo.hostname || !activeTabInfo.isHttp) return undefined;
    const norm = normalizeMirrorInput(activeTabInfo.hostname);
    if (!norm.ok) return undefined;
    if (isCoveredByHostList(norm.host, BUILTIN_MIRROR_HOSTS)) return undefined;
    const covering = userHosts.find((u) => norm.host === u || norm.host.endsWith(`.${u}`));
    if (covering) {
      // Already a mirror. When access is granted the content script only
      // loads on the NEXT navigation — offer a one-click tab reload.
      return { host: norm.host, eligible: false, offerReload: status[covering] === true };
    }
    if (userHosts.length >= MAX_USER_MIRRORS) {
      return { host: norm.host, eligible: false, offerReload: false };
    }
    return { host: norm.host, eligible: true, offerReload: false };
  }

  async function refreshMirrorsVm(): Promise<void> {
    const userHosts = await readUserMirrors(adapter);
    const status: Record<string, boolean> = {};
    const builtinStatus: Record<string, boolean> = {};
    await Promise.all([
      ...userHosts.map(async (hostName) => {
        status[hostName] = await hasOriginPermission(hostName);
      }),
      // Built-ins too: Firefox doesn't auto-grant host permissions added
      // by an extension update (bug 1893232) — show the re-grant chip.
      ...BUILTIN_MIRROR_HOSTS.map(async (hostName) => {
        builtinStatus[hostName] = await hasOriginPermission(hostName);
      }),
    ]);
    mirrorsVm = {
      builtinHosts: BUILTIN_MIRROR_HOSTS,
      userHosts,
      status,
      builtinStatus,
      canManagePermissions: true,
      maxMirrors: MAX_USER_MIRRORS,
      currentHost: computeCurrentHost(userHosts, status),
    };
  }
  await refreshMirrorsVm();

  const logger = createLogger({ scriptName: 'HDREZKA-POPUP' });
  const cleanup = new CleanupRegistry();
  const i18n = createTranslator(settingsStore.getKey('language'));

  const ui: UiPort = {
    refreshButtons: () => {},
    refreshSlider: () => {},
    showNotification: (text, kind) => showNotification(text, { kind, playerContainer: null }),
    applyLayout: () => {},
  };

  const discovery: DiscoveryPort = {
    hydrate: () => Promise.resolve(),
    resolve: () => null,
    invalidate: () => {},
    cacheStats: () => ({ hits: 0, misses: 0, ready: false }),
  };

  const diagnostics: DiagnosticsPort = {
    report: () => ({}) as DiagnosticReport,
    isHealthy: () => true,
    killSwitchEngaged: () => false,
    trip: () => {},
  };

  const ctx: AppContext = {
    site,
    settingsStore,
    speedStore,
    ui,
    discovery,
    diagnostics,
    cleanup,
    logger,
    i18n,
  };

  // 3. Inject the in-player CSS (same selectors -- the popup-style.css
  //    overrides .settings-menu positioning so it fills the popup body
  //    instead of floating).
  injectStyles(site);

  // 3a. Override the OS-based theme guess with whatever the content
  //     script last persisted for this site. injectStyles() above ran
  //     detectAndApplyTheme() which falls back to prefers-color-scheme
  //     (popup has no host-page attributes); but on YouTube the user's
  //     in-page light/dark toggle is the only authoritative signal —
  //     we capture it in lastSeenTheme on the host page side.
  const persistedTheme = settingsStore.getKey('lastSeenTheme');
  if (persistedTheme === 'dark' || persistedTheme === 'light') {
    document.documentElement.dataset.vsTheme = persistedTheme;
  }

  // 4. Render. activeTab persists across re-renders. On a tab that is
  //    neither a built-in nor a user mirror, open straight on Mirrors —
  //    that's the "I'm on a new mirror, make it work" entry point.
  const tabSupported =
    activeTabInfo.staticSite !== null ||
    (activeTabInfo.hostname !== null &&
      isCoveredByHostList(activeTabInfo.hostname, mirrorsVm.userHosts));
  let activeTab: ActiveTab = tabSupported ? 'general' : 'mirrors';
  function rerender(): void {
    const menu = h(
      'div',
      { class: 'settings-menu' },
      renderSettingsMenu({
        settings: settingsStore.get(),
        site,
        i18n: ctx.i18n,
        activeTab,
        scriptVersion: SCRIPT_VERSION,
        // KillSwitch flags are content-script-side; popup just shows them.
        discoveryEnabled: true,
        healthCheckEnabled: true,
        mirrors: mirrorsVm,
      }),
    );
    // Show the "open the player to run diagnostics" hint only on the
    // Diagnostics tab — on General/Keys/Donate it has no context and
    // just looked like a leaked tooltip pinned to the popup bottom
    // (audit 0.2.0). Goes BEFORE the menu so the user sees it before
    // they reach for the (greyed-out) action buttons.
    const children: Node[] = [];
    if (activeTab === 'diag') {
      children.push(
        h(
          'div',
          { class: 'vs-popup-diag-hint vs-popup-diag-hint-top' },
          ctx.i18n.t('diag.popup_hint'),
        ),
      );
    }
    // FEAT-021: quick speed row — change the video's speed right from
    // the toolbar without opening the in-player menu. Only rendered on
    // supported tabs; buttons highlight once the live speed is known.
    if (tabSupported) {
      const presets = settingsStore.getKey('speedPresets') ?? [];
      if (presets.length > 0) {
        const quickRow = h(
          'div',
          { class: 'vs-popup-quick', title: ctx.i18n.t('popup.quick.tip') },
          ...presets.map((s) =>
            h(
              'button',
              { type: 'button', class: 'speed-button vs-popup-quick-btn', 'data-vs-speed': s },
              `${s}x`,
            ),
          ),
        );
        const highlight = (speed: number | null): void => {
          for (const b of quickRow.querySelectorAll<HTMLButtonElement>('.vs-popup-quick-btn')) {
            const v = parseFloat(b.dataset.vsSpeed ?? '');
            b.classList.toggle(
              'active',
              speed !== null && Number.isFinite(v) && Math.abs(v - speed) < 0.005,
            );
          }
        };
        quickRow.addEventListener('click', (event) => {
          const btn = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(
            '.vs-popup-quick-btn',
          );
          if (!btn) return;
          const speed = parseFloat(btn.dataset.vsSpeed ?? '');
          if (!Number.isFinite(speed)) return;
          void sendSpeedMessage({ type: 'vs:set-speed', speed }).then((applied) => {
            if (applied === null) {
              ui.showNotification(ctx.i18n.t('popup.quick.no_video'), 'info');
            } else {
              highlight(applied);
            }
          });
        });
        void sendSpeedMessage({ type: 'vs:get-speed' }).then(highlight);
        children.push(quickRow);
      }
    }
    children.push(menu);
    host.replaceChildren(...children);
    attachSettingsHandlers(menu, ctx, {
      setActiveTab: (t) => {
        activeTab = t;
      },
      rerender,
      onDiag: async (action) => {
        if (action === 'recheck') {
          const report = await sendToActiveTab({ type: 'vs:recheck' });
          if (report) {
            applyReportToMenu(menu, ctx.i18n, report);
            ui.showNotification(
              report.healthy ? ctx.i18n.t('toast.diag_ok') : ctx.i18n.t('toast.diag_issues'),
              report.healthy ? 'info' : 'warn',
            );
          } else {
            ui.showNotification(ctx.i18n.t('diag.popup_hint'), 'info');
          }
          return;
        }
        if (action === 'copy') {
          const report = await sendToActiveTab({ type: 'vs:get-status' });
          if (report) {
            try {
              await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
              ui.showNotification(ctx.i18n.t('toast.report_copied'), 'info');
            } catch {
              ui.showNotification(ctx.i18n.t('toast.report_copy_failed'), 'error');
            }
          } else {
            ui.showNotification(ctx.i18n.t('diag.popup_hint'), 'info');
          }
          return;
        }
        if (action === 'purge-cache') {
          const ok = await sendToActiveTab({ type: 'vs:purge-cache' });
          ui.showNotification(
            ok ? ctx.i18n.t('toast.cache_cleared') : ctx.i18n.t('diag.popup_hint'),
            ok ? 'info' : 'warn',
          );
          return;
        }
        // full-reset stays gear-only — too destructive for a popup
        // misclick, no confirm dialog feels safe to ship here.
        ui.showNotification(ctx.i18n.t('diag.popup_hint'), 'info');
      },
      mirrors: {
        add: async (raw) => {
          // Validate against the in-memory snapshot SYNCHRONOUSLY so
          // permissions.request below is the first await — Firefox only
          // honours the request inside the user-input handler, and the
          // click's transient activation must not be burned on storage
          // reads first.
          const norm = normalizeMirrorInput(raw);
          if (!norm.ok) return norm;
          if (isCoveredByHostList(norm.host, BUILTIN_MIRROR_HOSTS)) {
            return { ok: false, reason: 'builtin' };
          }
          if (isCoveredByHostList(norm.host, mirrorsVm.userHosts)) {
            return { ok: false, reason: 'duplicate' };
          }
          if (mirrorsVm.userHosts.length >= MAX_USER_MIRRORS) {
            return { ok: false, reason: 'limit' };
          }
          // Denied permission still adds the mirror (same behaviour as
          // the in-player surface) — the row's badge + grant button make
          // the missing access visible and recoverable.
          await requestOriginPermission(norm.host);
          const res = await addUserMirror(adapter, norm.host);
          await refreshMirrorsVm();
          return res;
        },
        remove: async (hostName) => {
          // Background revokes the origin permission + unregisters the
          // dynamic script off storage.onChanged.
          await removeUserMirror(adapter, hostName);
          await refreshMirrorsVm();
        },
        grant: async (hostName) => {
          const granted = await requestOriginPermission(hostName);
          await refreshMirrorsVm();
          return granted;
        },
        reloadCurrentTab: () => {
          if (activeTabInfo.tabId !== null) {
            void browser.tabs.reload(activeTabInfo.tabId).catch(() => {});
            window.close();
          }
        },
        list: () => mirrorsVm.userHosts,
        replaceAll: async (hosts) => {
          await replaceUserMirrors(adapter, hosts);
          await refreshMirrorsVm();
        },
      },
    });

    // Force a fresh check on Diagnostics tab open (not get-status) so
    // popup and gear-menu always agree at the moment the user looks
    // at them. get-status returns the last cached report which can
    // lag the gear-menu's live one by a couple of seconds — same
    // page state, but two paths reading the cache at different times
    // produced contradictory readings (popup said "Waiting", gear
    // said "All good"). Forcing recheck adds ~50ms but eliminates
    // the surprise.
    if (activeTab === 'diag') {
      void sendToActiveTab({ type: 'vs:recheck' }).then((report) => {
        if (report) applyReportToMenu(menu, ctx.i18n, report);
      });
    }
  }

  // Re-init translator on language switch. Subscriber fires on every
  // update; rebuilding the translator is cheap (~150 keys).
  cleanup.add(
    settingsStore.subscribe((next) => {
      ctx.i18n = createTranslator(next.language as 'en' | 'ru');
    }),
  );

  // 5. Listen for storage.onChanged so the popup reflects edits made in
  //    the in-player gear without needing a manual refresh.
  //
  // Filtering is critical: HealthChecker writes selector-cache entries
  // (vs-cache:* keys) on every recheck, and the recheck the popup
  // itself triggers when Diagnostics opens caused a STORM of those
  // writes — each one fired this listener, each one rerendered the
  // entire popup, producing visible flicker on the Diagnostics tab
  // (audit 0.2.7). Only react to settings/speed key changes, not
  // cache or other internal state.
  const settingsKeys = new Set([
    storageKeysFor('hdrezka').settings,
    storageKeysFor('hdrezka').speed,
    // Mirrors list edits arrive from the in-player gear menu too.
    MIRRORS_STORAGE_KEY,
  ]);
  let pendingRerender: ReturnType<typeof setTimeout> | null = null;
  const storageListener = (changes: Record<string, unknown>): void => {
    if (changes.__vs_skip__) return;
    const changedKeys = Object.keys(changes);
    if (!changedKeys.some((k) => settingsKeys.has(k))) return;
    // Coalesce bursts from a single user action (settings update + speed
    // update arriving in the same frame) into one rerender. The mirrors
    // snapshot re-derives first so the Mirrors tab never paints stale.
    if (pendingRerender !== null) clearTimeout(pendingRerender);
    pendingRerender = setTimeout(() => {
      pendingRerender = null;
      void refreshMirrorsVm().then(rerender);
    }, 50);
  };
  browser.storage.local.onChanged.addListener(storageListener);
  cleanup.add(() => {
    if (pendingRerender !== null) clearTimeout(pendingRerender);
    browser.storage.local.onChanged.removeListener(storageListener);
  });

  rerender();
}

interface ActiveTabInfo {
  tabId: number | null;
  /** Lowercased (punycoded by URL) hostname; null when unreadable or
   *  the tab is not an http(s) page. */
  hostname: string | null;
  isHttp: boolean;
  /** Built-in mirror detection result for the hostname. */
  staticSite: Site | null;
}

/**
 * Inspect the active tab. activeTab (granted by the toolbar click) makes
 * the URL readable on arbitrary pages; on chrome:// / about: / extension
 * pages we still get the tab id but report no hostname.
 *
 * Strategy ladder, in order of authority (audit 0.2.0):
 *   1) {active:true, currentWindow:true} — THE tab the user was looking
 *      at when they clicked the toolbar button.
 *   2) {active:true, lastFocusedWindow:true} — covers the dev case where
 *      the popup is opened directly as chrome-extension://…/popup.html.
 */
async function detectActiveTab(): Promise<ActiveTabInfo> {
  const none: ActiveTabInfo = { tabId: null, hostname: null, isHttp: false, staticSite: null };
  try {
    const ourPopupPrefix = browser.runtime.getURL('/popup.html');
    const queries = [
      { active: true, currentWindow: true },
      { active: true, lastFocusedWindow: true },
    ] as const;
    for (const q of queries) {
      const tabs = await browser.tabs.query(q);
      const tab = tabs.find((t) => !t.url?.startsWith(ourPopupPrefix)) ?? tabs[0];
      if (!tab) continue;
      const tabId = typeof tab.id === 'number' ? tab.id : null;
      if (!tab.url) return { ...none, tabId };
      try {
        const u = new URL(tab.url);
        const isHttp = u.protocol === 'http:' || u.protocol === 'https:';
        const hostname = isHttp ? u.hostname.toLowerCase() : null;
        return {
          tabId,
          hostname,
          isHttp,
          staticSite: hostname ? detectSite(hostname) : null,
        };
      } catch {
        return { ...none, tabId };
      }
    }
  } catch {
    // tabs.query rejected — fall through to "nothing known".
  }
  return none;
}

/**
 * Send a message to the content script in the active tab and resolve to
 * its response payload (or `null` if the tab/frame doesn't have our
 * content script — e.g. user opened the popup on chrome://, a non-video
 * page, etc.). The content script's `vs:*` handlers all reply with
 * `{ ok, report? }` or `{ ok, error? }`; we collapse that to either the
 * report (for query-style commands) or a boolean ok flag.
 */
async function sendToActiveTab(message: {
  type: 'vs:recheck' | 'vs:get-status';
}): Promise<DiagnosticReport | null>;
async function sendToActiveTab(message: { type: 'vs:purge-cache' }): Promise<boolean>;
async function sendToActiveTab(message: {
  type: string;
}): Promise<DiagnosticReport | boolean | null> {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (typeof tabId !== 'number') return null;
    const res = (await browser.tabs.sendMessage(tabId, message)) as
      | { ok: boolean; report?: DiagnosticReport; error?: string }
      | undefined;
    if (!res?.ok) return null;
    if (message.type === 'vs:purge-cache') return true;
    return res.report ?? null;
  } catch {
    // No content script in active tab, or message channel closed —
    // both legit (popup opened off a video page).
    return null;
  }
}

/** FEAT-021: speed read/write channel for the popup quick-actions row. */
async function sendSpeedMessage(message: {
  type: 'vs:get-speed' | 'vs:set-speed';
  speed?: number;
}): Promise<number | null> {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (typeof tabId !== 'number') return null;
    const res = (await browser.tabs.sendMessage(tabId, message)) as
      | { ok: boolean; speed?: number }
      | undefined;
    if (!res?.ok || typeof res.speed !== 'number') return null;
    return res.speed;
  } catch {
    return null;
  }
}

/**
 * Live-update the Diagnostics status block with a freshly received
 * report. Mirrors the read paths in diag-status.ts but sources the
 * report from the message-passing channel instead of `ctx.diagnostics`
 * (which in popup context is a stub).
 */
function applyReportToMenu(
  menuRoot: Element,
  i18n: { t: (key: string, vars?: Record<string, string | number>) => string },
  report: DiagnosticReport,
): void {
  const statusEl = menuRoot.querySelector<HTMLElement>('[data-vs-diag-status]');
  const headlineEl = menuRoot.querySelector<HTMLElement>('[data-vs-diag-headline]');
  const detailEl = menuRoot.querySelector<HTMLElement>('[data-vs-diag-detail]');
  if (!statusEl || !headlineEl || !detailEl) return;

  const r = report as unknown as Record<string, unknown>;
  const waiting = r.isWaiting === true;
  const healthy = r.healthy === true;
  const issues = Array.isArray(r.issues) ? (r.issues as string[]) : [];
  const lastCheckTime = typeof r.lastCheckTime === 'string' ? r.lastCheckTime : '';

  if (waiting) {
    statusEl.dataset.state = 'waiting';
    headlineEl.textContent = i18n.t('diag.status.waiting');
    detailEl.textContent = i18n.t('diag.status.waiting_detail');
    return;
  }
  if (healthy) {
    statusEl.dataset.state = 'ok';
    headlineEl.textContent = i18n.t('diag.status.ok');
    detailEl.textContent = lastCheckTime
      ? i18n.t('diag.status.last_check', { time: lastCheckTime })
      : '';
    return;
  }
  statusEl.dataset.state = 'warn';
  if (issues.length === 1) {
    headlineEl.textContent = i18n.t('diag.status.issue_single', { issue: issues[0] ?? '' });
    detailEl.textContent = i18n.t('diag.status.try_again');
  } else {
    // Audit 2026-05-09 Q2: pluralized key.
    const issuesCountKey =
      issues.length === 1 ? 'diag.status.issues_count.one' : 'diag.status.issues_count.other';
    headlineEl.textContent = i18n.t(issuesCountKey, { count: issues.length });
    detailEl.textContent =
      issues.length > 0 ? issues.map((s) => `• ${s}`).join('\n') : i18n.t('diag.status.try_again');
  }
}
