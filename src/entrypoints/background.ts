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
import { refreshPermissionBadge as refreshBadge } from '../health/permission-badge';
import { detectBrowserLang } from '../i18n/detect';
import {
  calibrationPoints,
  DEFAULT_DIM_LEVEL,
  dedupeScreens,
  pickOtherDisplays,
  type Rect,
  type ScreenGeom,
  type ScreenRecipe,
  sameScreen,
  screensTouchedByPlayer,
} from '../screens/dim-screens';
import {
  coverRect,
  isPlacementAcceptable,
  looksLikeSpoofedScreen,
  type ProbeReport,
  parseScreenReport,
} from '../screens/placement';
import {
  BUILTIN_MIRROR_HOSTS,
  builtinMatchPatterns,
  originPatternsFor,
} from '../sites/mirror-hosts';
import { classifyMirrorBody, type MirrorReach } from '../sites/mirror-reach';
import { createBrowserStorageAdapter } from '../storage/adapter';
import { MIRRORS_STORAGE_KEY, readUserMirrors, sanitizeMirrorList } from '../storage/mirrors-store';

/** Single dynamic-registration id covering ALL user mirrors. */
const DYNAMIC_SCRIPT_ID = 'user-mirrors';

/**
 * FEAT-020 dim state: which windows we opened and for which tab. Lives in
 * storage.session, NOT a module variable — MV3 evicts the worker between
 * events, and a forgotten window id means a black monitor the user can only
 * close by hand. Session storage dies with the browser, which is exactly the
 * lifetime the dim windows have.
 */
const DIM_STATE_KEY = 'vs-dim-state';
interface DimState {
  tabId: number;
  windowIds: number[];
}

/**
 * Firefox-only screen map (storage.local, not session): calibration costs a
 * visible sweep of probe windows, so it must survive a browser restart. It is
 * invalidated only by the user re-running it — a monitor unplugged since then
 * simply produces a recipe that lands somewhere harmless.
 */
const SCREEN_MAP_KEY = 'vs-screen-map';

/**
 * Bump whenever the MEANING of a stored screen record changes. v2 switched
 * the geometry from CSS pixels to physical ones; v3 added the CSS size needed
 * to grow a window. A map from an older version never matches a fresh report,
 * so every placement gets rejected and nothing dims — silently, which is the
 * worst way to fail. An unknown version is treated as "not calibrated".
 */
const SCREEN_MAP_VERSION = 4;
interface StoredScreenMap {
  v: number;
  screens: ScreenRecipe[];
}

/**
 * Outcome of the last dim attempt, shown in the settings dialog. Without it
 * "nothing happened" is indistinguishable from "no monitors on record" or
 * "every placement missed" — and the user is left guessing, which is exactly
 * how this feature burned several rounds of debugging.
 */
const DIM_RESULT_KEY = 'vs-dim-last-result';
interface DimResult {
  wanted: number;
  placed: number;
  reason: 'ok' | 'no-map' | 'no-player-screen' | 'spoofed-screen' | 'missed';
}

/**
 * Set while dimming is meant to be on screen. The overlays' heartbeat is
 * answered ONLY while this is set, so "the worker no longer knows about you"
 * makes an overlay close itself instead of hanging around for the user to
 * hunt down — the failure mode that actually bit during development.
 */
const DIM_ACTIVE_KEY = 'vs-dim-active';

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

/**
 * Built output of the tiny auto-follow sniffer entrypoint
 * (src/entrypoints/sniffer.content.ts). WXT names a `<x>.content.ts`
 * entrypoint `content-scripts/<x>.js`; `registration: 'runtime'` keeps it out
 * of the manifest so we register it broadly here only when opted in.
 */
const SNIFFER_SCRIPT_FILE = 'content-scripts/sniffer.js';

export default defineBackground(() => {
  const adapter = createBrowserStorageAdapter();

  // FEAT-016: brand the toolbar speed badge (cyan fill). Idempotent — runs
  // on every SW wake but is cheap; wrapped because `action` can be briefly
  // unavailable during early startup.
  try {
    void browser.action.setBadgeBackgroundColor({ color: '#0e7490' });
  } catch {
    /* action API not ready — badge still works with the default colour */
  }

  /**
   * The one string this worker shows. Deliberately NOT in src/i18n/dict.ts:
   * importing the translator pulls the whole 60 kB dictionary into a service
   * worker that wakes on every browser event, to render a single tooltip.
   */
  const NO_ACCESS_TITLE = {
    ru: 'У HDRezka Speed Controller нет доступа к HDRezka — нажмите, чтобы выдать его, иначе панель не появится',
    en: 'HDRezka Speed Controller has no access to HDRezka — click to allow it, or the panel will not appear',
  } as const;

  // The rule itself lives in src/health/permission-badge.ts — shared with the
  // twin and therefore watched by the drift checker. This used to be duplicated
  // verbatim in both background.ts files, where nothing would have noticed a
  // fix landing in only one of them.
  const refreshPermissionBadge = (): Promise<boolean> =>
    refreshBadge(browser.action, browser.permissions, {
      // One group per mirror: any single working mirror means the extension is
      // usable, and the badge stays quiet.
      originGroups: BUILTIN_MIRROR_HOSTS.map((host) => originPatternsFor(host)),
      alertTitle: NO_ACCESS_TITLE[detectBrowserLang()],
    });
  void refreshPermissionBadge();

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
   * Register/unregister the broad auto-follow SNIFFER. Active only when the
   * user opted in AND granted the broad host permission. Instead of loading
   * the full ~219 KB content script on every page (which self-bailed on
   * non-HDRezka pages), the tiny sniffer runs everywhere, and on a signature
   * hit asks us to executeScript the real script into just that tab (see the
   * 'auto-follow:inject' handler). Independent of the user-mirrors registration.
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
    // (built-in mirrors) and the user-mirrors dynamic script — the full
    // content.js already runs there, so the sniffer must not also fire and
    // executeScript a duplicate. (The boot guard would block the second
    // bootstrap, but skipping the redundant sniffer + injection is cleaner.)
    const userHosts = await readUserMirrors(adapter);
    const excludeMatches = [
      ...builtinMatchPatterns(),
      ...userHosts.flatMap((h) => originPatternsFor(h)),
    ];

    const script = {
      id: AUTO_FOLLOW_SCRIPT_ID,
      js: [SNIFFER_SCRIPT_FILE],
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

  /**
   * FEAT-019/#10: inject the full content script into a tab the sniffer
   * flagged as HDRezka. Re-checks the opt-in flag + broad grant — the message
   * crosses a trust boundary, even though the sniffer's own registration
   * already implies both. The page-level boot guard makes a duplicate inject a
   * no-op, so we don't track per-tab injection state.
   */
  async function injectFullScript(tabId: number): Promise<void> {
    const blob = await adapter.get<Record<string, unknown> | null>(SETTINGS_STORAGE_KEY, null);
    const enabled = !!(blob && typeof blob === 'object' && blob.autoFollowMirrors === true);
    if (!enabled) return;
    const hasBroad = await browser.permissions.contains({ origins: [BROAD_ORIGIN] });
    if (!hasBroad) return;
    // executeScript's `files` is typed as a leading-slash public path (unlike
    // registerContentScripts' `js`), so this literal — not CONTENT_SCRIPT_FILE.
    await browser.scripting
      .executeScript({ target: { tabId }, files: ['/content-scripts/content.js'] })
      .catch((e: unknown) => {
        console.warn('[HDREZKA-SPEEDS] auto-follow inject failed (tab %d)', tabId, e);
      });
  }

  /**
   * Classify a mirror by READING its homepage. A no-cors HEAD only tells us
   * "something answered", which is worthless: ISP-blocked domains return a
   * stub / anti-bot page with HTTP 200, so a HEAD marks a dead mirror
   * reachable and we open a blank page. The extension holds host permissions
   * for the built-ins, so the SW can fetch cross-origin and read the body;
   * classification lives in the pure, unit-tested mirror-reach module.
   * `credentials: 'omit'` — never send the user's cookies on a probe.
   */
  /** A no-cors HEAD needs NO host permission and resolves on any reachable
   *  host (opaque). Used only as a fallback to tell "reachable but unreadable"
   *  from "dead" when the content read below rejects. */
  async function isReachableNoCors(host: string): Promise<boolean> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    try {
      await fetch(`https://${host}/`, {
        method: 'HEAD',
        mode: 'no-cors',
        redirect: 'follow',
        cache: 'no-store',
        signal: ctrl.signal,
      });
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async function classifyMirror(host: string): Promise<MirrorReach> {
    const ctrl = new AbortController();
    // Live/challenge mirrors answer in well under a second; this bound only
    // decides how long we wait on a DEAD host before giving up, so keep it
    // short — it caps the "Open HDRezka" button's worst-case wait.
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch(`https://${host}/`, {
        redirect: 'follow',
        cache: 'no-store',
        credentials: 'omit',
        signal: ctrl.signal,
      });
      if (!res.ok) return 'dead';
      return classifyMirrorBody(res.ok, await res.text());
    } catch {
      // The content read (default cors mode) rejects for TWO reasons: the host
      // is truly dead, OR we lack the granted host permission to read it
      // cross-origin (Firefox can leave a built-in ungranted after an
      // extension update — bug 1893232). A no-cors HEAD needs no permission
      // and still resolves on a reachable host, so it tells "reachable but
      // unreadable" (challenge — still opens) from "dead". Keeps this probe
      // never worse than the old permission-free HEAD.
      return (await isReachableNoCors(host)) ? 'challenge' : 'dead';
    } finally {
      clearTimeout(timer);
    }
  }

  /** Reachability map for a set of hosts (all classified in parallel). */
  async function probeMirrors(hosts: string[]): Promise<Record<string, MirrorReach>> {
    const states = await Promise.all(hosts.map(classifyMirror));
    const out: Record<string, MirrorReach> = {};
    hosts.forEach((host, i) => {
      out[host] = states[i] as MirrorReach;
    });
    return out;
  }

  /**
   * "Open HDRezka": classify the ordered candidates (parallel) and open the
   * first LIVE one, falling back to the first CHALLENGE (a bot-check that may
   * still pass in a real tab). NEVER opens a DEAD one — if every candidate is
   * dead we return {ok:false} and the popup tells the user to open a mirror
   * themselves (which then becomes the remembered last-working host). Lives in
   * the SW so it isn't blocked by the extension-pages CSP and can read
   * built-in hosts via the manifest host permissions.
   */
  async function openReachableMirror(candidates: string[]): Promise<{ ok: boolean }> {
    if (candidates.length === 0) return { ok: false };
    const states = await Promise.all(candidates.map(classifyMirror));
    const liveIdx = states.indexOf('live');
    const idx = liveIdx >= 0 ? liveIdx : states.indexOf('challenge');
    if (idx < 0) return { ok: false };
    try {
      await browser.tabs.create({ url: `https://${candidates[idx]}/` });
      return { ok: true };
    } catch (e) {
      console.warn('[HDREZKA-SPEEDS] open-reachable failed', e);
      return { ok: false };
    }
  }

  // ---- FEAT-020: dim the other monitors during fullscreen playback ----

  /**
   * Placement trace, always on.
   *
   * The Firefox path decides where an overlay goes from numbers that only
   * exist on the user's actual monitor layout — no test rig and no automated
   * Firefox can reproduce them (side-load signature enforcement blocks it).
   * When a grey rectangle shows up on the wrong screen, this narration is the
   * only evidence there is. It costs ~10 lines per fullscreen entry, in the
   * background worker's console (about:debugging -> Inspect), which nobody
   * has open unless they are debugging exactly this.
   */
  const dimLog = (msg: string, data?: unknown): void => {
    if (data === undefined) console.log(`[HDREZKA-SPEEDS][dim] ${msg}`);
    else console.log(`[HDREZKA-SPEEDS][dim] ${msg}`, data);
  };

  /**
   * chrome.system.display, or null where it doesn't exist (Firefox). Reached
   * through globalThis because the webextension-polyfill typings the rest of
   * this file uses don't cover the system.* namespaces.
   */
  function systemDisplay(): { getInfo(): Promise<{ bounds: Rect }[]> } | null {
    const api = (
      globalThis as {
        chrome?: { system?: { display?: { getInfo?: unknown } } };
      }
    ).chrome?.system?.display;
    return api && typeof api.getInfo === 'function'
      ? (api as { getInfo(): Promise<{ bounds: Rect }[]> })
      : null;
  }

  async function readDimState(): Promise<DimState | null> {
    try {
      const got = await browser.storage.session.get(DIM_STATE_KEY);
      const state = (got as Record<string, unknown>)[DIM_STATE_KEY] as DimState | undefined;
      return state && Array.isArray(state.windowIds) ? state : null;
    } catch {
      return null;
    }
  }

  /**
   * Close every dim window we know about and forget them. Idempotent.
   *
   * `keepActive` matters when a calibration sweep runs INSIDE an active dim
   * request: clearing the active flag there would make the overlays we are
   * about to raise fail their own heartbeat and close themselves.
   */
  async function closeDimWindows(keepActive = false): Promise<void> {
    const state = await readDimState();
    dimLog('close overlays', { windowIds: state?.windowIds ?? [], keepActive });
    if (state) {
      await Promise.all(
        state.windowIds.map((id) =>
          browser.windows.remove(id).catch(() => {
            // Already closed by the user (the overlay closes on click) or by
            // a browser restart — nothing to clean up.
          }),
        ),
      );
    }
    const keys = keepActive ? [DIM_STATE_KEY] : [DIM_STATE_KEY, DIM_ACTIVE_KEY];
    await browser.storage.session.remove(keys).catch(() => undefined);
  }

  async function recordDimResult(result: DimResult): Promise<void> {
    await browser.storage.local.set({ [DIM_RESULT_KEY]: result }).catch(() => undefined);
  }

  /** True while overlays are supposed to be up — the heartbeat's answer. */
  async function dimIsActive(): Promise<boolean> {
    try {
      const got = await browser.storage.session.get(DIM_ACTIVE_KEY);
      return (got as Record<string, unknown>)[DIM_ACTIVE_KEY] === true;
    } catch {
      return false;
    }
  }

  async function readScreenMap(): Promise<ScreenRecipe[]> {
    try {
      const got = await browser.storage.local.get(SCREEN_MAP_KEY);
      const stored = (got as Record<string, unknown>)[SCREEN_MAP_KEY] as
        | StoredScreenMap
        | undefined;
      // A map written by an older format is worse than no map: every stored
      // screen would fail to match a fresh report and dimming would do
      // nothing at all, with no visible reason.
      if (!stored || stored.v !== SCREEN_MAP_VERSION || !Array.isArray(stored.screens)) return [];
      return stored.screens;
    } catch {
      return [];
    }
  }

  async function saveScreenMap(map: ScreenRecipe[]): Promise<void> {
    await browser.storage.local
      .set({ [SCREEN_MAP_KEY]: { v: SCREEN_MAP_VERSION, screens: map } satisfies StoredScreenMap })
      .catch(() => undefined);
  }

  /** Probe id → resolver, for the reports coming back from dim.html. */
  const pendingProbes = new Map<string, (report: ProbeReport) => void>();

  /**
   * Reports that arrived before anyone was waiting.
   *
   * Every caller does `await browser.windows.create(...)` FIRST and only then
   * calls waitForProbe — so a dim page that loads and reports before the create
   * promise resolves used to hit an empty registry and have its report dropped
   * on the floor. The caller then waited out its full timeout and treated a
   * perfectly good probe as "no answer": a real screen missing from the map, or
   * a valid candidate closed so the next (wrong) one could flash on a monitor.
   * Same failure class as the truncated report — a message lost at a boundary
   * with nothing to show for it.
   */
  const earlyProbes = new Map<string, ProbeReport>();

  function deliverProbe(probeId: string, report: ProbeReport): void {
    const waiting = pendingProbes.get(probeId);
    if (waiting) waiting(report);
    else earlyProbes.set(probeId, report);
  }

  function waitForProbe(probeId: string, ms: number): Promise<ProbeReport | null> {
    const early = earlyProbes.get(probeId);
    if (early) {
      earlyProbes.delete(probeId);
      return Promise.resolve(early);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingProbes.delete(probeId);
        // No report: the window failed to load or was closed by the user.
        resolve(null);
      }, ms);
      pendingProbes.set(probeId, (report) => {
        clearTimeout(timer);
        pendingProbes.delete(probeId);
        resolve(report);
      });
    });
  }

  /**
   * Firefox calibration: walk the guessed coordinate grid, note which screen
   * each point actually lands on, and keep one recipe per distinct screen.
   * Sequential on purpose — a burst of windows fights the window manager and
   * makes the placement itself unreliable. Probes are black, so the sweep
   * reads as a flicker rather than a strobe.
   */
  /**
   * How long one calibration probe may take to say where it landed.
   *
   * Measured with the web-ext harness (.claude/skills/twin-extensions/
   * probe-firefox-coords): a probe that is going to answer answers in well
   * under a second. The old 2500ms was pure worst-case padding, and with 35
   * grid points it made a fully failing sweep take a minute and a half — long
   * enough for Firefox to evict the background event page mid-sweep and leave
   * a silently partial map.
   *
   * NOT an early exit. The obvious "stop after a barren row" was measured to be
   * WRONG here: on this desktop the third monitor is only reachable from
   * (-FAR, FAR), which lives in the LAST row of the grid, so any row-based
   * bail-out would drop a real screen. Cheaper probes, same coverage.
   */
  const CALIBRATION_PROBE_MS = 1500;

  async function calibrateScreens(): Promise<ScreenRecipe[]> {
    const found: ScreenRecipe[] = [];
    // Counted to tell "this desktop really has one monitor" apart from "the
    // browser is reporting the probe window as the screen" (see
    // looksLikeSpoofedScreen).
    let answered = 0;
    let spoofed = 0;
    let n = 0;
    // A previous run that was cut short (worker evicted, browser busy) can
    // have left overlays up; they'd sit under the probe sweep and confuse it.
    // Keep the active flag: this sweep may be running inside a live dim
    // request, whose overlays are raised right after it.
    await closeDimWindows(true);
    for (const point of calibrationPoints()) {
      const probeId = `p${++n}`;
      let created: { id?: number } | undefined;
      try {
        created = await browser.windows.create({
          url: dimUrl(100, probeId, true),
          type: 'popup',
          focused: false,
          left: point.rawLeft,
          top: point.rawTop,
          width: 240,
          height: 160,
        });
      } catch {
        continue;
      }
      const report = await waitForProbe(probeId, CALIBRATION_PROBE_MS);
      if (typeof created?.id === 'number') {
        await browser.windows.remove(created.id).catch(() => undefined);
      }
      // A report without the CSS rect cannot be placed OR matched against a
      // window later; storing it with a zeroed origin would put a phantom
      // screen at (0,0) that attracts every overlap test.
      if (report?.css) {
        answered += 1;
        if (looksLikeSpoofedScreen(report)) spoofed += 1;
        found.push({
          ...report.geom,
          rawLeft: point.rawLeft,
          rawTop: point.rawTop,
          cssLeft: report.css.l,
          cssTop: report.css.t,
          cssWidth: report.css.w,
          cssHeight: report.css.h,
        });
      }
    }
    const map = dedupeScreens(found);
    await saveScreenMap(map);
    // If the browser was reporting the probe window's own size as "the screen",
    // the map is fiction — say so instead of letting the settings panel claim a
    // monitor was found. Reuses the last-result channel the panel already reads.
    if (spoofed > 0 && spoofed === answered) {
      await recordDimResult({ wanted: 0, placed: 0, reason: 'spoofed-screen' });
    }
    return map;
  }

  function dimUrl(level: number, probeId?: string, throwaway = false): string {
    const hash = `l=${Math.round(level)}${probeId ? `&p=${probeId}` : ''}${
      throwaway ? '&probe=1' : ''
    }`;
    return `${browser.runtime.getURL('/dim.html')}#${hash}`;
  }

  /**
   * Firefox placement, verified instead of trusted.
   *
   * The calibration recipe is only a HINT: measured on Firefox 145, the same
   * coordinates land differently depending on the window's size and the
   * target screen's scale — a recipe recorded with a 240×160 probe sent a
   * full-size overlay to (-21333,-21333), off every monitor, collapsed to a
   * title bar. So each overlay opens UNFOCUSED (invisible, not raised),
   * reports the screen it actually reached, and only a window that landed on
   * the wanted screen — and not on the player's, and not on one already
   * covered — is raised and made fullscreen. Everything else is closed and
   * the next candidate is tried.
   */
  const MAX_PLACEMENT_TRIES = 4;

  /** A verified overlay: its window id plus the coordinates that produced it. */
  interface Placement {
    id: number;
    rawLeft: number;
    rawTop: number;
  }

  async function placeOverlay(
    target: ScreenRecipe,
    player: ScreenGeom | null,
    covered: ScreenGeom[],
    level: number,
  ): Promise<Placement | null> {
    const candidates = [
      { rawLeft: target.rawLeft, rawTop: target.rawTop },
      ...calibrationPoints(),
    ].slice(0, MAX_PLACEMENT_TRIES);

    let probeSeq = 0;
    dimLog('place: target', { target, candidates });
    for (const point of candidates) {
      const probeId = `o${Date.now() % 100000}-${++probeSeq}`;
      let created: { id?: number } | undefined;
      try {
        created = await browser.windows.create({
          // throwaway=true: a candidate that is never confirmed must die on
          // its own. Without the deadline, a window whose close() silently
          // failed sat on the user's monitor forever, still answering the
          // heartbeat as "active" — exactly the strays seen in testing.
          url: dimUrl(level, probeId, true),
          type: 'popup',
          focused: false,
          left: point.rawLeft,
          top: point.rawTop,
          // Deliberately tiny: this window exists only to answer "which
          // screen did I land on?". Anything bigger flashes its light window
          // frame across the desktop before it is confirmed and grown.
          width: 160,
          height: 120,
        });
      } catch {
        continue;
      }
      const report = await waitForProbe(probeId, 2000);
      const landedOn = report?.geom ?? null;
      const id = created?.id;
      dimLog(`probe #${probeSeq} at (${point.rawLeft},${point.rawTop}) landed`, {
        landedOn,
        onTarget: landedOn != null && sameScreen(landedOn, target),
        onPlayerScreen: landedOn != null && player != null && sameScreen(landedOn, player),
        alreadyCovered: landedOn != null && covered.some((seen) => sameScreen(seen, landedOn)),
      });
      const good =
        typeof id === 'number' && isPlacementAcceptable({ landedOn, target, player, covered });
      if (good && typeof id === 'number') {
        // Tell the window it is now an overlay, so it cancels the self-close
        // deadline every candidate window carries (see dim/main.ts).
        await browser.runtime.sendMessage({ type: 'vs:dim-keep', probeId }).catch(() => undefined);
        // Raise it: measured on Windows, an unfocused window is NOT raised, so
        // the overlay would sit behind whatever is already on that monitor and
        // dim nothing. Focusing does not move a window.
        await browser.windows.update(id, { focused: true }).catch(() => undefined);
        // Cover the monitor this window is ALREADY on, by arithmetic.
        //
        // state: 'fullscreen' is not used for placement: the transition
        // re-picks which display the window belongs to, and that is how a
        // black rectangle kept landing on the screen playing the film. A
        // window given an explicit rect in the window-API's own coordinates
        // stays where it is. The rect leaves the taskbar visible, because it
        // is built from the screen's AVAILABLE area — which is the right
        // trade on a monitor nobody is looking at.
        const before = await browser.windows.get(id).catch(() => null);
        const rect = coverRect(report, before);
        if (rect) {
          await browser.windows.update(id, rect).catch(() => undefined);
        } else {
          // Nothing measurable came back (page never reported, or an older
          // overlay build). Fall back to the historical behaviour rather than
          // leaving a 160x120 window pretending to dim a monitor.
          await browser.windows.update(id, { state: 'fullscreen' }).catch(() => undefined);
        }
        // Raise it only now: measured on Windows, an unfocused window is not
        // raised and would sit behind whatever is already on that monitor.
        await browser.windows.update(id, { focused: true }).catch(() => undefined);
        // Now — and only now — go fullscreen, to drop Firefox's title bar and
        // cover the taskbar. Doing this to place the window is what threw it
        // onto the monitor playing the film; doing it to a window ALREADY
        // sitting on the right monitor is safe: measured over 7 probes on a
        // 3-monitor desktop, the transition never moved a window off the
        // screen it was on. The recheck below still verifies it.
        if (rect) {
          await browser.windows.update(id, { state: 'fullscreen' }).catch(() => undefined);
        }
        const settled = await browser.windows.get(id).catch(() => null);
        dimLog(rect ? 'sized to cover the monitor' : 'no measurement — used fullscreen', {
          id,
          wanted: rect,
          // The inputs the rect is derived from. A page that reports its size
          // before the window has settled would inflate the scale factor and
          // produce a rect big enough to cover every monitor at once — the
          // result alone cannot tell that apart from a placement error.
          inputs: {
            apiWidth: before?.width,
            apiLeft: before?.left,
            apiTop: before?.top,
            pageOuterWidth: report?.self?.ow,
            pageSelf: report?.self,
            pageScreen: report?.css,
            k: before?.width && report?.self?.ow ? before.width / report.self.ow : null,
          },
          state: settled?.state,
          left: settled?.left,
          top: settled?.top,
          width: settled?.width,
          height: settled?.height,
        });

        // Promotion MOVES the window (measured: left jumped a full monitor
        // width), so the screen check done on the small trial window says
        // nothing about where the overlay ended up. Ask again, now that it is
        // in its final state, and refuse to keep a window that drifted onto
        // the player's screen or off its target — that drift is exactly how a
        // grey rectangle ended up on the monitor showing the video.
        const recheck = waitForProbe(probeId, 1500);
        await browser.runtime
          .sendMessage({ type: 'vs:dim-recheck', probeId })
          .catch(() => undefined);
        const finalGeom = (await recheck)?.geom ?? null;
        const stillRight =
          finalGeom != null &&
          sameScreen(finalGeom, target) &&
          !(player != null && sameScreen(finalGeom, player));
        // No answer at all (window busy mid-transition) is not treated as a
        // failure: closing a working overlay is worse than keeping one whose
        // recheck timed out.
        dimLog('recheck after promotion', {
          finalGeom,
          stillRight,
          verdict: finalGeom != null && !stillRight ? 'DRIFTED -> closing' : 'kept',
        });
        if (finalGeom != null && !stillRight) {
          await browser.windows.remove(id).catch(() => undefined);
          continue;
        }
        return { id, rawLeft: point.rawLeft, rawTop: point.rawTop };
      }
      if (typeof id === 'number') await browser.windows.remove(id).catch(() => undefined);
    }
    dimLog('place: no candidate landed on target', { target });
    return null;
  }

  /**
   * Open one dim window per target and promote it to fullscreen.
   *
   * `state: 'fullscreen'` can't be combined with left/top/width/height (both
   * engines reject it), so each window is CREATED at the target's coordinates
   * and only then promoted — which also hides the popup title bar that would
   * otherwise leave a lit strip on the screen.
   *
   * `focused: true` looks wrong here and isn't: measured on Windows, an
   * unfocused window is NOT raised, so the overlay ends up BEHIND whatever
   * already sits on that monitor and dims nothing. So each overlay is raised
   * with focus, and focus is handed straight back to the player's window —
   * see the caller. Losing focus does not drop an HTML5 video out of
   * fullscreen (verified in the Chrome smoke).
   */
  async function raiseOverlays(targets: Rect[], level: number): Promise<number[]> {
    const url = dimUrl(level);
    const windowIds: number[] = [];
    for (const target of targets) {
      try {
        const created = await browser.windows.create({
          url,
          type: 'popup',
          focused: true,
          left: target.left,
          top: target.top,
          width: target.width,
          height: target.height,
        });
        if (typeof created?.id !== 'number') continue;
        windowIds.push(created.id);
        await browser.windows.update(created.id, { state: 'fullscreen' }).catch(() => {
          // Window manager refused fullscreen — the window still covers the
          // display's bounds, just with its title bar showing.
        });
      } catch (e) {
        console.warn('[HDREZKA-SPEEDS] dim window create failed', e);
      }
    }
    return windowIds;
  }

  /** Chrome path: exact display bounds, minus the one holding the player. */
  async function chromeTargets(windowId: number): Promise<Rect[]> {
    const display = systemDisplay();
    if (!display) return [];
    const [displays, playerWindow] = await Promise.all([
      display.getInfo(),
      browser.windows.get(windowId),
    ]);
    if (
      typeof playerWindow.left !== 'number' ||
      typeof playerWindow.top !== 'number' ||
      typeof playerWindow.width !== 'number' ||
      typeof playerWindow.height !== 'number'
    ) {
      return [];
    }
    return pickOtherDisplays(displays, {
      left: playerWindow.left,
      top: playerWindow.top,
      width: playerWindow.width,
      height: playerWindow.height,
    }).map((d) => d.bounds);
  }

  /**
   * Firefox path: one verified placement per calibrated screen. Returns the
   * ids of the overlays that actually landed where they were meant to.
   * Empty map = the user hasn't calibrated yet; the settings UI says so.
   */
  async function firefoxOverlays(playerWindow: Rect | null, level: number): Promise<number[]> {
    const map = await readScreenMap();
    // NO calibration from here. The sweep walks coordinates across the whole
    // desktop, so running it at fullscreen-time flashes probe windows over
    // every monitor INCLUDING the one playing the video. Calibration belongs
    // to the settings dialog, where the user is looking at the screen anyway;
    // here we only record why nothing happened so the UI can say it.
    if (map.length === 0) {
      await recordDimResult({ wanted: 0, placed: 0, reason: 'no-map' });
      return [];
    }
    // Which monitors is the film on? Decided from the PLAYER'S WINDOW rect,
    // not from screen.avail* read in the content script: Firefox's
    // fingerprinting protection falsifies those (it says so in the page
    // console), so the player's own screen matched nothing and was dimmed
    // along with the rest.
    const touched = playerWindow ? screensTouchedByPlayer(map, playerWindow) : [];
    const wanted = map.filter((s) => !touched.some((t) => sameScreen(t, s)));
    dimLog('firefox path', { playerWindow, touched, calibratedScreens: map, wanted });
    // FAIL SAFE. If the window rect is unavailable, or it overlaps no screen
    // on record (an unplugged monitor, a stale map, a window parked
    // off-screen), we do NOT know where the film is — and dimming everything
    // "just in case" is precisely the bug this feature keeps producing: a
    // black rectangle over the video. Dim nothing and say why.
    if (touched.length === 0) {
      await recordDimResult({ wanted: map.length, placed: 0, reason: 'no-player-screen' });
      return [];
    }
    const ids: number[] = [];
    const covered: ScreenGeom[] = [];
    // The recipe in the map was recorded by a 160x120 calibration probe, and a
    // full-size overlay does NOT land where a tiny window did — so candidate #1
    // misses, goes fullscreen on the wrong monitor, and is closed again. That
    // miss is the half-second grey wall over the player's own screen, and
    // without this it repeated on EVERY fullscreen entry. Coordinates that
    // produced a verified overlay are written back, so the next entry hits on
    // the first try and nothing flashes.
    let learned = false;
    for (const target of wanted) {
      const placed = await placeOverlay(target, touched[0] ?? null, covered, level);
      if (placed != null) {
        ids.push(placed.id);
        covered.push(target);
        if (placed.rawLeft !== target.rawLeft || placed.rawTop !== target.rawTop) {
          target.rawLeft = placed.rawLeft;
          target.rawTop = placed.rawTop;
          learned = true;
          dimLog('learned overlay recipe', { target: target.availLeft, ...placed });
        }
      }
    }
    if (learned) await saveScreenMap(map);
    await recordDimResult({
      wanted: wanted.length,
      placed: ids.length,
      reason: ids.length === wanted.length ? 'ok' : 'missed',
    });
    return ids;
  }

  async function openDimWindows(tabId: number, windowId: number, level: number): Promise<void> {
    // The player's window rect, straight from the window API. This replaces
    // the screen geometry the content script used to send: Firefox's
    // fingerprinting protection falsifies screen.avail* in page context, so
    // that value could not identify the monitor showing the film.
    const w = await browser.windows.get(windowId).catch(() => null);
    const playerWindow: Rect | null =
      w &&
      typeof w.left === 'number' &&
      typeof w.top === 'number' &&
      typeof w.width === 'number' &&
      typeof w.height === 'number'
        ? { left: w.left, top: w.top, width: w.width, height: w.height }
        : null;
    dimLog('dim-on', { level, playerWindow, engine: systemDisplay() ? 'chrome' : 'firefox' });
    // Never stack two generations of overlays (re-entering fullscreen, a
    // second tab going fullscreen): the previous set is always closed first.
    await closeDimWindows();
    // Mark dimming active BEFORE the first window opens: overlays start their
    // heartbeat immediately and must not read "unknown" while we're still
    // placing them.
    await browser.storage.session.set({ [DIM_ACTIVE_KEY]: true }).catch(() => undefined);

    // Chrome knows the exact bounds up front and can place blind; Firefox has
    // to verify each placement (see placeOverlay), so the two paths differ in
    // kind, not just in where the coordinates come from.
    const windowIds = systemDisplay()
      ? await raiseOverlays(await chromeTargets(windowId), level)
      : await firefoxOverlays(playerWindow, level);
    dimLog('overlays raised', { windowIds });
    if (windowIds.length === 0) return;

    // Hand focus back to the player. The overlays had to take it to be raised
    // above whatever was already on those monitors (see raiseOverlays), but
    // the keyboard must end up back where the video is.
    await browser.windows.update(windowId, { focused: true }).catch(() => undefined);
    // Persist even a partial set: whatever opened must be closable later.
    if (windowIds.length > 0) {
      await browser.storage.session
        .set({ [DIM_STATE_KEY]: { tabId, windowIds } satisfies DimState })
        .catch(() => undefined);
    }
  }

  // The owning tab can die without ever sending dim-off (crash, close while
  // fullscreen, discard). Without this the overlays would outlive it.
  browser.tabs.onRemoved.addListener((tabId) => {
    void readDimState().then((state) => {
      if (state?.tabId === tabId) return closeDimWindows();
      return undefined;
    });
  });

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
    // Every trigger that can change what we may run on — install, update,
    // startup, a grant, a revoke — is also every moment the warning badge can
    // become right or wrong.
    void refreshPermissionBadge();
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
    // Reject messages from other extensions. This side owns windows.create and
    // scripting.registerContentScripts — strictly more power than the content
    // script, whose own handler has validated its sender since audit 2026-05-09
    // (src/index.ts). The asymmetry was an oversight, not a decision.
    //
    // Deliberately NOT rejecting tab senders the way index.ts does: our own
    // content scripts and extension pages are exactly who talks to this worker.
    // `sender.id` is absent for same-extension messages in some engines, so
    // only a PRESENT and FOREIGN id is refused.
    if (sender?.id && sender.id !== browser.runtime.id) return undefined;
    if (!msg || typeof msg !== 'object') return undefined;
    const m = msg as {
      type?: unknown;
      path?: unknown;
      text?: unknown;
      candidates?: unknown;
      hosts?: unknown;
      level?: unknown;
      screen?: unknown;
      probeId?: unknown;
      geom?: unknown;
      css?: unknown;
      self?: unknown;
    };
    // FEAT-020: the content script owns the fullscreen signal, we own the
    // windows. Both handlers return their promise so MV3 can't evict the
    // worker mid-flight and strand a black window on someone's monitor.
    if (m.type === 'vs:dim-on') {
      const tabId = sender.tab?.id;
      const windowId = sender.tab?.windowId;
      if (typeof tabId !== 'number' || typeof windowId !== 'number') return undefined;
      const level = typeof m.level === 'number' ? m.level : DEFAULT_DIM_LEVEL;
      // `m.screen` (the page's own screen geometry) is deliberately IGNORED —
      // Firefox's fingerprinting protection falsifies it. The monitor showing
      // the player is derived from the tab's window rect instead.
      return openDimWindows(tabId, windowId, level).catch((e: unknown) => {
        console.warn('[HDREZKA-SPEEDS] dim on failed', e);
      });
    }
    // Overlay heartbeat. Answering it is the whole contract: an overlay that
    // stops getting an answer (extension reloaded/updated/disabled) closes
    // itself instead of sitting on the user's monitor forever.
    if (m.type === 'vs:dim-ping') return dimIsActive().then((ok) => ({ ok }));
    // A calibration probe reporting the screen it landed on.
    if (m.type === 'vs:screen-report') {
      const parsed = parseScreenReport(m);
      if (parsed) deliverProbe(parsed.probeId, parsed.report);
      return undefined;
    }
    // Settings → "find my monitors" (Firefox). Returns the resulting map so
    // the UI can report how many screens were found.
    if (m.type === 'vs:calibrate-screens') {
      return calibrateScreens()
        .then((map) => ({ ok: true, screens: map.length }))
        .catch((e: unknown) => ({ ok: false, error: String(e) }));
    }
    // How many screens are on record + how the last dim attempt went. Both
    // drive the settings hint, so "nothing happened" always has a reason
    // the user can read.
    if (m.type === 'vs:screen-map') {
      return Promise.all([
        readScreenMap(),
        browser.storage.local
          .get(DIM_RESULT_KEY)
          .then((got) => (got as Record<string, unknown>)[DIM_RESULT_KEY] as DimResult | undefined)
          .catch(() => undefined),
      ])
        .then(([map, last]) => ({ ok: true, screens: map.length, last }))
        .catch(() => ({ ok: false, screens: 0 }));
    }
    if (m.type === 'vs:dim-off') {
      return closeDimWindows().catch((e: unknown) => {
        console.warn('[HDREZKA-SPEEDS] dim off failed', e);
      });
    }
    if (m.type === 'mirrors:get-status') {
      return getMirrorStatus().catch((e: unknown) => ({ ok: false, error: String(e) }));
    }
    // Live reachability of the given hosts (popup Mirrors tab dots). Reads each
    // homepage body to tell a working mirror from an ISP stub / bot-check.
    if (m.type === 'mirrors:probe') {
      const hosts = Array.isArray(m.hosts)
        ? (m.hosts as unknown[]).filter(
            (hostName): hostName is string => typeof hostName === 'string',
          )
        : [];
      return probeMirrors(hosts)
        .then((reach) => ({ ok: true, reach }))
        .catch(() => ({ ok: false }));
    }
    // "Open HDRezka" (popup): open the first reachable candidate mirror,
    // skipping ISP-blocked ones. Returns the promise so the SW stays alive
    // through the probe + tab open.
    if (m.type === 'mirrors:open-reachable') {
      const candidates = Array.isArray(m.candidates)
        ? (m.candidates as unknown[]).filter((c): c is string => typeof c === 'string')
        : [];
      return openReachableMirror(candidates).catch(() => ({ ok: false }));
    }
    // FEAT-016: the content script mirrors the live playback rate onto the
    // toolbar icon badge. Only the SW can call chrome.action; the sender's
    // tab id targets the right tab. Fire-and-forget — no response channel.
    if (m.type === 'vs:speed-badge') {
      const tabId = sender.tab?.id;
      if (typeof tabId === 'number') {
        const text = typeof m.text === 'string' ? m.text.slice(0, 4) : '';
        browser.action.setBadgeText({ tabId, text }).catch(() => {
          // Tab gone / action API unavailable — best-effort.
        });
      }
      return undefined;
    }
    // FEAT-019/#10: the broadly-registered sniffer asks us to inject the full
    // content script into its own tab once it confirmed the HDRezka signature.
    if (m.type === 'auto-follow:inject') {
      const tabId = sender.tab?.id;
      if (typeof tabId !== 'number') return undefined;
      // Return the promise (not fire-and-forget): MV3 can terminate the SW as
      // soon as the handler returns, cutting off an in-flight executeScript.
      // The trailing .catch guarantees a resolved (never rejected) response —
      // a harmless `undefined` the sniffer ignores.
      return injectFullScript(tabId).catch(() => undefined);
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
