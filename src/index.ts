/**
 * bootstrap(wxtCtx) — the orchestrator for HDRezka.
 *
 * Called from src/entrypoints/content.ts on every content-script load.
 * Wires every collaborator together in dependency order, hands the final
 * AppContext to the speed controller, the panel, and the health checker.
 *
 * Order:
 *   0. Detect site; bail out if unsupported.
 *   1. TM coexistence check; early-exit if userscript is also active.
 *   2. Build hydrated stores + cache.
 *   3. Build the discovery engine.
 *   4. Build i18n translator + logger + cleanup + meter.
 *   5. Stub UiPort -> stub Diagnostics so the AppContext is whole enough
 *      to construct the panel.
 *   6. Build the panel.
 *   7. Wrap panel as the real UiPort; swap into ctx.ui.
 *   8. Build the real DiagnosticsPort backed by HealthChecker; swap.
 *   9. Run TM migration if first run.
 *  10. Inject styles + insert panel into the player.
 *  11. Attach video listeners (apply initial speed, restore on `playing`).
 *  12. Start the health watchdog.
 *  13. HDRezka site bootstrap (Plyr LS-patch + new-video MutationObserver).
 */

import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { CleanupRegistry } from './app/cleanup';
import type { AppContext } from './app/context';
import type { DiagnosticsPort, Logger as LoggerPort, Translator, UiPort } from './app/ports';
import { SPEED_STEP, speedBoundsFor } from './config';
import { createSelectorCache } from './discovery/cache';
import { createDiscoveryEngine } from './discovery/engine';
import { Validators } from './discovery/validators';
import { createHealthChecker } from './health/checker';
import { createKillSwitch } from './health/kill-switch';
import { reportToClipboardText } from './health/report';
import type { DiagnosticReport } from './health/types';
import { detectBrowserLang } from './i18n/detect';
import { createTranslator } from './i18n/translator';
import {
  detectSite,
  extractHDRezkaEpisodeKey,
  extractHDRezkaTitleId,
  isHDRezkaVideoPath,
  looksLikeHDRezka,
} from './sites/detect';
import { bootstrapHDRezkaSite, patchPlyrLocalStorage } from './sites/hdrezka';
import { BUILTIN_MIRROR_HOSTS, isCoveredByHostList } from './sites/mirror-hosts';
import {
  applyTransient,
  pickInitialSpeed,
  SELF_WRITE_GRACE_MS,
  setTemporary,
} from './speed/controller';
import { matchesHotkeyArray } from './speed/hotkeys';
import { createRatechangeMeter } from './speed/meter';
import { applyVolumeBoost } from './speed/volume-boost';
import { createBrowserStorageAdapter, type StorageAdapter } from './storage/adapter';
import { createCoalescingAdapter } from './storage/adapter-coalescing';
import { writeLastWorkingHost } from './storage/last-host-store';
import {
  clearPosition,
  formatClock,
  isResumeworthy,
  readPosition,
  writePosition,
} from './storage/last-position-store';
import { runTmMigration } from './storage/migration-tm';
import {
  addUserMirror,
  MAX_USER_MIRRORS,
  readUserMirrors,
  removeUserMirror,
  replaceUserMirrors,
} from './storage/mirrors-store';
import { createSettingsStore } from './storage/settings-store';
import { createSpeedStore } from './storage/speed-store';
import { createPanel, createUiPort, injectStyles, insertPanel, installThemeWatcher } from './ui';
import { showActionChip, showNotification } from './ui/notifications';
import type { PanelMirrors } from './ui/panel';
import { installFullscreenReparent } from './ui/popup';
import type { MirrorsViewModel } from './ui/settings/modal';
import { createLogger } from './utils/logger';
import {
  detectAndClaim,
  release as releaseCoexistMarker,
  warnIfHdrezkaImprovementPresent,
} from './utils/tm-coexist';

declare const __VS_VERSION__: string | undefined;
const SCRIPT_VERSION = typeof __VS_VERSION__ === 'string' ? __VS_VERSION__ : '0.1.0';

export interface BootstrapOptions {
  /** Storage adapter override. Defaults to the wxt/browser-backed one;
   *  the userscript build injects a GM-storage adapter here so the same
   *  code path runs unchanged inside Tampermonkey. */
  adapter?: StorageAdapter;
}

export async function bootstrap(
  wxtCtx: ContentScriptContext,
  options: BootstrapOptions = {},
): Promise<void> {
  // Idempotency guard (isolated-world global, not page-reachable): in
  // auto-follow mode a host can match BOTH the broad content script and the
  // built-in / user-mirror registration, injecting content.js twice into one
  // frame. This flag is set synchronously — before step 0's first await — so
  // the second injection bails race-free. Cleared on invalidation so HMR /
  // re-injection still work. (detectAndClaim's DOM marker can't cover the
  // user-mirror case alone: step 0 awaits storage before it claims.)
  type BootFlag = typeof globalThis & { __hdrezkaSpeedsBooted?: boolean };
  const bootFlag = globalThis as BootFlag;
  if (bootFlag.__hdrezkaSpeedsBooted) {
    console.info('[HDREZKA-SPEEDS] already booted in this frame; skipping duplicate injection');
    return;
  }
  bootFlag.__hdrezkaSpeedsBooted = true;
  wxtCtx.onInvalidated(() => {
    delete bootFlag.__hdrezkaSpeedsBooted;
  });

  // Storage adapter — created BEFORE site detection because the
  // user-mirrors fallback below needs a storage read. (Used to live in
  // step 2; hoisting is side-effect-free, the adapter holds no state.)
  const adapter = options.adapter ?? createBrowserStorageAdapter();

  // 0. Site detection. Static built-ins first; on a miss the host may be
  //    a user-added mirror — those pages are reached via the dynamically
  //    registered content script (background.ts) whose matches mirror the
  //    stored list, so the storage check below is the authoritative gate.
  let site = detectSite();
  if (!site) {
    try {
      const userMirrors = await readUserMirrors(adapter);
      if (isCoveredByHostList(location.hostname.toLowerCase(), userMirrors)) {
        site = 'hdrezka';
      }
    } catch {
      // Storage unreachable — treat as unsupported.
    }
  }
  // Auto-follow (part B): the broad content script reaches an unknown host
  // only when the user opted in. If the page's DOM carries HDRezka's engine
  // signature, treat it as a mirror — domain-name lists lose to renamed /
  // hash-prefixed mirrors, the signature doesn't. A false positive is
  // harmless: at most a speed panel on a non-rezka video page. No permission
  // is granted here; the broad grant is the user's separate opt-in.
  //
  // Bounded retry (not a one-shot): the signature IS the gate here, and
  // HDRezka's player markers aren't always in the DOM the instant
  // document_idle fires — same reason attachToVideo / scheduleInsertWithRetry
  // retry below. Resolves instantly when the signature is already present, so
  // a real rezka page pays no delay; on a genuine non-rezka page it waits out
  // the budget and bails. Only reached in auto-follow mode on non-listed
  // hosts, so ordinary browsing never pays this cost.
  if (!site && (await awaitHDRezkaSignature(wxtCtx))) {
    site = 'hdrezka';
  }
  if (!site) {
    console.info('[HDREZKA-SPEEDS] unsupported host, bootstrap aborted');
    return;
  }

  // 0a. URL allow-list. HDRezka video pages always end in `.html`
  //     (/films/.../id-slug.html etc.). On listing pages like /continue/,
  //     /favorites/, /personal/, search, category indexes, profile
  //     pages there is no playable <video> — but DiscoveryEngine's
  //     heuristic strategies happily promote some random wide container
  //     to "playerContainer" and drop the speed panel into the page.
  //     Bail early so the panel never appears off-context.
  if (!isHDRezkaVideoPath(location.pathname)) {
    console.info('[HDREZKA-SPEEDS] non-video path, bootstrap aborted:', location.pathname);
    return;
  }

  // 1. TM coexistence.
  const decision = detectAndClaim();
  if (!decision.proceed) {
    const lang = detectBrowserLang();
    const { t } = createTranslator(lang);
    showNotification(t('tm.detected.body'), { kind: 'warn', duration: 6000 });
    console.info('[HDREZKA-SPEEDS] coexistence:', decision.reason);
    return;
  }

  // 1a. Soft-detect HDrezka-Improvement userscript. Doesn't block us —
  //     it touches layout/theme rather than speed control — but a
  //     console.warn helps triage when a user reports a weird overlap.
  warnIfHdrezkaImprovementPresent();

  const cleanup = new CleanupRegistry();
  wxtCtx.onInvalidated(() => {
    releaseCoexistMarker();
    cleanup.dispose();
  });

  const logger = createLogger({ scriptName: 'HDREZKA-SPEEDS' });
  logger.info(`bootstrap site=${site} version=${SCRIPT_VERSION}`);

  // 2. Storage stores (adapter hoisted above step 0).
  const settingsStore = createSettingsStore(adapter);
  // Audit 2026-05-09 perf O1: coalesce speedStore writes (hotkey repeat,
  // slider drag) into a 200ms window. Audit 2026-05-11 W2.1 (REL-004):
  // surface coalesced write errors so quota-exceeded / runtime-invalidated
  // failures don't disappear silently.
  // REL-033/038 (2026-06-10): keep a handle on the coalescing adapter so
  // pending writes can be flushed on pagehide, and surface write failures
  // to the user (once per page) instead of only logging them.
  let notifyStorageWriteError: (() => void) | null = null;
  const coalescedSpeedAdapter = createCoalescingAdapter(adapter, {
    flushMs: 200,
    onWriteError: (key, err) => {
      logger.warn(`speedStore coalesced write failed for ${key}`, err);
      notifyStorageWriteError?.();
    },
  });
  const speedStore = createSpeedStore(coalescedSpeedAdapter);
  await settingsStore.init(site);
  await speedStore.init(site);
  // FEAT-015: per-title memory key — the numeric HDRezka id is stable
  // across every episode of a show, so this gives per-series memory.
  speedStore.setActiveMemoryKey(extractHDRezkaTitleId(location.pathname));
  // Without this, a double-click "save as default" followed by an instant
  // reload (within the 200 ms coalesce window) silently loses the write.
  cleanup.addEventListener(window, 'pagehide', () => {
    void coalescedSpeedAdapter.flushNow();
  });

  // 3. Discovery.
  // killSwitch is declared early (TDZ guard, audit 2026-05-09 sec C6) so
  // the closure inside isFullChainEnabled below can safely reference it
  // even if a future change in createDiscoveryEngine starts evaluating
  // the closure synchronously during construction.
  let killSwitch!: ReturnType<typeof createKillSwitch>;
  const cache = createSelectorCache(adapter, {
    scriptVersion: SCRIPT_VERSION,
  });
  await cache.hydrate();
  const discoveryEngine = createDiscoveryEngine({
    site,
    cache,
    validators: Validators,
    isFullChainEnabled: () => killSwitch?.isDiscoveryEnabled() ?? true,
    logger,
  });
  const discoveryPort = {
    hydrate: () => Promise.resolve(),
    resolve: (key: string) => discoveryEngine.resolve(key as never)?.element ?? null,
    invalidate: (key: string) => cache.purge(key as never),
    cacheStats: () => ({
      hits: discoveryEngine.metrics().cacheHits,
      misses: discoveryEngine.metrics().cacheMisses,
      ready: cache.isReady(),
    }),
  };

  // 4. Cross-cutting.
  const meter = createRatechangeMeter();
  // `lang` is mutable so the settings subscriber below can compare against
  // the LAST observed value, not the bootstrap-time value. With const, a
  // round-trip EN → RU → EN silently failed to switch back because the
  // baseline `lang` never updated.
  let lang = settingsStore.getKey('language');
  const i18n: Translator = createTranslator(lang);

  // 5. Stubs for the chicken-and-egg with UiPort + DiagnosticsPort.
  const stubUi: UiPort = {
    refreshButtons: () => {},
    refreshSlider: () => {},
    showNotification: () => {},
    applyLayout: () => {},
  };
  const stubDiagnostics: DiagnosticsPort = {
    report: () => ({}) as DiagnosticReport,
    isHealthy: () => true,
    killSwitchEngaged: () => false,
    trip: () => {},
  };

  const ctx: AppContext = {
    site,
    settingsStore,
    speedStore,
    ui: stubUi,
    discovery: discoveryPort,
    diagnostics: stubDiagnostics,
    cleanup,
    logger: logger as LoggerPort,
    i18n,
  };

  // 6. KillSwitch + HealthChecker (need ctx).
  killSwitch = createKillSwitch(ctx);
  const healthChecker = createHealthChecker({
    ctx,
    scriptVersion: SCRIPT_VERSION,
    discovery: discoveryEngine,
    meter,
    killSwitch: killSwitch.snapshot,
    selectorCache: cache,
    isHealthCheckEnabled: killSwitch.isHealthCheckEnabled,
    // Audit 2026-05-09 M2: pass the killSwitch handle so the checker
    // can re-arm itself if health-check is toggled back ON after bootstrap.
    killSwitchHandle: killSwitch,
    // After N consecutive unhealthy reports, flip the kill-switch's
    // health-check flag so the watchdog stops re-running and re-purging
    // the cache. The gear's red dot stays lit (panel.setGearWarning is
    // wired below), so the user gets a visible signal to investigate.
    onConsecutiveFailures: (count) => {
      logger.warn(
        `auto-trip: kill-switch health-check disabled after ${count} consecutive failures`,
      );
      void killSwitch.setHealthCheckEnabled(false);
    },
  });
  ctx.diagnostics = {
    report: () => healthChecker.runOnce(),
    isHealthy: healthChecker.isHealthy,
    killSwitchEngaged: () => !killSwitch.isHealthCheckEnabled(),
    trip: () => void killSwitch.trip(),
  };

  // 6a. User-mirrors surface for the Mirrors tab. Extension build only:
  //     `options.adapter` is the userscript marker (GM storage injected),
  //     and in Tampermonkey the @match list — not extension permissions —
  //     governs where the script runs, so the tab would only mislead.
  let panelMirrors: PanelMirrors | undefined;
  if (!options.adapter) {
    const vm: MirrorsViewModel = {
      builtinHosts: BUILTIN_MIRROR_HOSTS,
      userHosts: [],
      status: null,
      builtinStatus: null,
      canManagePermissions: false,
      maxMirrors: MAX_USER_MIRRORS,
    };
    // Permission status lives behind the background SW: content scripts
    // can't call browser.permissions. Failure leaves status=null and the
    // UI renders "unknown" badges.
    const fetchStatus = async (): Promise<{
      status: Record<string, boolean>;
      builtinStatus: Record<string, boolean> | null;
    } | null> => {
      try {
        const { browser: br } = await import('wxt/browser');
        const res = (await br.runtime.sendMessage({ type: 'mirrors:get-status' })) as
          | {
              ok?: boolean;
              status?: Record<string, boolean>;
              builtinStatus?: Record<string, boolean>;
            }
          | undefined;
        if (res?.ok && res.status) {
          return { status: res.status, builtinStatus: res.builtinStatus ?? null };
        }
      } catch {
        // SW unreachable / userscript shim — keep "unknown".
      }
      return null;
    };
    const refreshMirrors = async (): Promise<boolean> => {
      let changed = false;
      try {
        const hosts = await readUserMirrors(adapter);
        if (JSON.stringify(hosts) !== JSON.stringify(vm.userHosts)) {
          vm.userHosts = hosts;
          changed = true;
        }
      } catch {
        // Keep the stale list.
      }
      const st = await fetchStatus();
      if (
        st &&
        (JSON.stringify(st.status) !== JSON.stringify(vm.status) ||
          JSON.stringify(st.builtinStatus) !== JSON.stringify(vm.builtinStatus))
      ) {
        vm.status = st.status;
        vm.builtinStatus = st.builtinStatus;
        changed = true;
      }
      return changed;
    };
    // Warm the snapshot so the first gear-open paints real data.
    void refreshMirrors();
    panelMirrors = {
      getViewModel: () => vm,
      refresh: refreshMirrors,
      add: async (raw) => {
        const res = await addUserMirror(adapter, raw);
        if (res.ok) await refreshMirrors();
        return res;
      },
      remove: async (host) => {
        await removeUserMirror(adapter, host);
        await refreshMirrors();
      },
      replaceAll: async (hosts) => {
        await replaceUserMirrors(adapter, hosts);
        await refreshMirrors();
      },
    };
  }

  // 7. Inject styles, build panel, build real UiPort.
  injectStyles(site);
  const panel = createPanel({
    ctx,
    scriptVersion: SCRIPT_VERSION,
    mirrors: panelMirrors,
    killSwitch: {
      isDiscoveryEnabled: () => killSwitch.isDiscoveryEnabled(),
      isHealthCheckEnabled: () => killSwitch.isHealthCheckEnabled(),
      setDiscoveryEnabled: (on) => killSwitch.setDiscoveryEnabled(on),
      setHealthCheckEnabled: (on) => killSwitch.setHealthCheckEnabled(on),
    },
    diagActions: {
      recheck: () => {
        void healthChecker.runOnce();
      },
      copyReport: async () => {
        const report = healthChecker.getLastReport() ?? healthChecker.runOnce();
        const text = reportToClipboardText(report);
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch {
          return false;
        }
      },
      purgeCache: async () => {
        const confirmText = ctx.i18n.t('diag.purge_cache_confirm');
        const ok = typeof window.confirm === 'function' ? window.confirm(confirmText) : true;
        if (!ok) return;
        await cache.purgeAll();
        logger.info('diag: selector cache purged');
      },
      fullReset: async () => {
        const confirmText = ctx.i18n.t('diag.full_reset_confirm');
        const ok = typeof window.confirm === 'function' ? window.confirm(confirmText) : true;
        if (!ok) return;
        await cache.purgeAll();
        await settingsStore.reset();
        await speedStore.setSmart(null);
        await speedStore.setCurrent(speedBoundsFor(site).defaultSpeed);
        logger.info('diag: full reset performed');
      },
    },
  });
  // FEAT-016: reflect the live playback rate on the toolbar icon badge.
  // The SW owns chrome.action; we just message it the text to show ('' at
  // 1×). Deduped so the HLS-cascade retry storm doesn't spam the SW, and
  // the wxt/browser import is lazy + swallowed so the userscript build
  // (no toolbar, aliased-to-throwing shim) is a silent no-op.
  let lastBadgeText: string | null = null;
  const setToolbarBadge = (speed: number): void => {
    const text =
      Number.isFinite(speed) && Math.abs(speed - 1) > 0.005
        ? parseFloat(speed.toFixed(2)).toString()
        : '';
    if (text === lastBadgeText) return;
    lastBadgeText = text;
    void import('wxt/browser')
      .then(({ browser: br }) => br.runtime.sendMessage({ type: 'vs:speed-badge', text }))
      .catch(() => {
        /* SW asleep or userscript shim — badge is best-effort */
      });
  };

  const realUi = createUiPort({
    panel,
    playerContainer: () => discoveryPort.resolve('playerContainer'),
    onSpeed: setToolbarBadge,
  });
  ctx.ui = realUi;
  cleanup.add(() => panel.dispose());

  // FEAT-016: clear the toolbar badge when the page goes away — a same-tab
  // navigation to a non-rezka page would otherwise leave the last speed
  // lingering on the icon (Chrome persists per-tab badge across navigations).
  cleanup.addEventListener(window, 'pagehide', () => setToolbarBadge(1));

  // REL-038: real UI exists now — arm the storage-write-failure toast.
  // Shown at most once per page load to avoid a toast storm when the
  // adapter is persistently broken (quota exceeded, dead SW).
  let storageErrorToastShown = false;
  notifyStorageWriteError = () => {
    if (storageErrorToastShown) return;
    storageErrorToastShown = true;
    try {
      ctx.ui.showNotification(ctx.i18n.t('toast.storage_write_failed'), 'warn');
    } catch {
      /* notification is best-effort */
    }
  };

  const offSettingsSub = settingsStore.subscribe((next) => {
    // Audit 2026-05-09 MAJOR-bootstrap: also force a panel rerender so
    // on-screen strings update immediately instead of staying stale.
    if (next.language !== lang) {
      lang = next.language;
      ctx.i18n = createTranslator(next.language);
      try {
        panel.rerenderSettings();
      } catch {
        /* swallow — rerender is best-effort */
      }
    }
  });
  cleanup.add(offSettingsSub);

  // 8. TM migration (one-shot).
  if (settingsStore.getKey('__migrated_from_tm') !== true) {
    const result = await runTmMigration(site, settingsStore, speedStore);
    if (result.imported) {
      ctx.ui.showNotification(ctx.i18n.t('migration.tm_imported'), 'info');
    }
  }

  // 9. Insert the panel.
  scheduleInsertWithRetry(panel.element, ctx);
  panel.applyLayout();

  // 9a. Wire the theme watcher AFTER the panel exists.
  const reapplyTheme = installThemeWatcher(site, ctx, () => panel.element);

  // Audit 2026-05-11 W6.3 (REL-014 + PERF-008): debounce by 500 ms
  // so a host-page class-shuffle doesn't trigger a write storm.
  let persistThemeTimer: ReturnType<typeof setTimeout> | null = null;
  const persistTheme = (): void => {
    const theme = document.documentElement.dataset.vsTheme;
    if (theme !== 'dark' && theme !== 'light') return;
    if (settingsStore.getKey('lastSeenTheme') === theme) return;
    if (persistThemeTimer !== null) clearTimeout(persistThemeTimer);
    persistThemeTimer = setTimeout(() => {
      persistThemeTimer = null;
      const liveTheme = document.documentElement.dataset.vsTheme;
      if (liveTheme !== 'dark' && liveTheme !== 'light') return;
      if (settingsStore.getKey('lastSeenTheme') === liveTheme) return;
      void settingsStore.update({ lastSeenTheme: liveTheme }).catch(() => {
        /* fire-and-forget */
      });
    }, 500);
  };
  cleanup.add(() => {
    if (persistThemeTimer !== null) {
      clearTimeout(persistThemeTimer);
      persistThemeTimer = null;
    }
  });
  persistTheme();
  const themePersistObserver = new MutationObserver(persistTheme);
  themePersistObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-vs-theme'],
  });
  ctx.cleanup.addObserver(themePersistObserver);

  // 9.5 Plyr localStorage patch — MUST run before attachToVideo. Plyr
  //      writes its full settings blob (including `speed`) during initial
  //      player init at document_idle; if the patch lands afterwards,
  //      those early writes poison Plyr's persisted blob and fight our
  //      restore on the next page load.
  patchPlyrLocalStorage(ctx);

  // FEAT-018: "continue where you left off". Tracks the play position per
  // title (throttled) and, on a fresh page, offers a durable resume chip.
  // Threaded into attachToVideo so it re-arms cleanly on every episode
  // change / <video> replacement via the per-attach cleanup registry.
  const seekVideoTo = (v: HTMLVideoElement, seconds: number): void => {
    const doSeek = (): void => {
      try {
        const dur = Number.isFinite(v.duration) ? v.duration : Number.POSITIVE_INFINITY;
        v.currentTime = Math.min(Math.max(0, seconds), dur);
      } catch (e) {
        ctx.logger.warn('resume: seek failed', e);
      }
    };
    // Seeking before metadata is a no-op on HLS/Plyr — gate on readyState.
    if (v.readyState >= 1) doSeek();
    else v.addEventListener('loadedmetadata', doSeek, { once: true });
  };

  const resumeHooks: ResumeHooks = {
    onVideoReady(v, attachCleanup) {
      const titleId = extractHDRezkaTitleId(location.pathname);
      if (!titleId) return;

      // (a) Track progress — one write per ~5s; drop the entry once finished
      //     so a future visit doesn't offer to resume the credits. The
      //     episode key is recomputed at each write: right after an AJAX
      //     episode swap the `.active` marker can lag the new <video> by a
      //     tick, and a live read here keeps writes filed under the right
      //     episode once playback (and the marker) have settled.
      let lastWrite = 0;
      attachCleanup.addEventListener(v, 'timeupdate', () => {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (now - lastWrite < 5000) return;
        lastWrite = now;
        const key = extractHDRezkaEpisodeKey(titleId);
        const t = v.currentTime;
        const dur = v.duration;
        if (isResumeworthy(t, dur)) {
          void writePosition(adapter, key, t, location.pathname);
        } else if (Number.isFinite(dur) && dur > 0 && t > dur - 90) {
          void clearPosition(adapter, key);
        }
      });

      // (b) Offer resume — once per attach, only when starting near the top
      //     (don't second-guess a player that already restored a position).
      const readKey = extractHDRezkaEpisodeKey(titleId);
      void readPosition(adapter, readKey).then((saved) => {
        if (!saved || saved.t < 30) return;
        if (attachCleanup.isDisposed || v.currentTime > 15) return;
        const close = showActionChip(ctx.i18n.t('resume.chip', { time: formatClock(saved.t) }), {
          kind: 'info',
          icon: 'play',
          duration: 15000,
          dismissLabel: ctx.i18n.t('chip.dismiss'),
          playerContainer: discoveryPort.resolve('playerContainer'),
          onActivate: () => seekVideoTo(v, saved.t),
        });
        // Stale the offer once the user is already watching past it.
        attachCleanup.addEventListener(v, 'timeupdate', () => {
          if (v.currentTime >= saved.t - 2 || v.currentTime > 60) close();
        });
        attachCleanup.add(close);
      });
    },
  };

  // 10. Attach to <video>. Nested CleanupRegistry per attach so we can
  //     dispose the ratechange/loadstart listeners cleanly when HDRezka
  //     mounts a new <video> on episode change.
  let attachCleanup = new CleanupRegistry();
  cleanup.add(() => attachCleanup.dispose());
  attachToVideo(ctx, meter, attachCleanup, 0, resumeHooks);

  // REL-040 (twin of VideoSpeeds): the player can replace the <video>
  // ELEMENT (not just src) after a fatal decode error, with no SPA
  // navigation — all per-element listeners die with the old node and the
  // fresh element plays at rate=1 until the next navigation. Media events
  // don't bubble, but capture-phase listeners on document still see them:
  // any 'playing' from an unbranded <video> == a fresh element → dispose
  // the stale per-attach registry and re-arm. The __vsAttached brand makes
  // this a no-op for already-attached elements. The video validator
  // filters hover previews/thumbnails so they don't dispose the live
  // attach registry.
  ctx.cleanup.addEventListener(
    document,
    'playing',
    (event) => {
      const t = event.target;
      if (!(t instanceof HTMLVideoElement)) return;
      if ((t as HTMLVideoElement & { __vsAttached?: boolean }).__vsAttached) return;
      if (!Validators.video(t).ok) return;
      ctx.logger.info('unattached <video> is playing (element replaced?); re-attaching');
      attachCleanup.dispose();
      attachCleanup = new CleanupRegistry();
      attachToVideo(ctx, meter, attachCleanup, 0, resumeHooks);
    },
    { capture: true },
  );

  // 11. Hotkey listener (global, capture so it wins over the page).
  // FEAT-012: per-page memory for the toggle-last-speed hotkey.
  let toggleLastSpeed: number | null = null;
  ctx.cleanup.addEventListener(
    document,
    'keydown',
    (event) => {
      const ev = event as KeyboardEvent;
      if (shouldSkipHotkey(ev)) return;
      const hk = settingsStore.getKey('hotkeys');
      // Audit 2026-05-11 W2.6 (PERF-004): match the hotkey BEFORE
      // resolving <video>. discovery.resolve() calls
      // getBoundingClientRect via its validator — every keystroke
      // used to pay that cost even when the user was typing in a
      // search field. Reordering keeps the resolve in the matched
      // branch only.
      const speedUp = matchesHotkeyArray(ev, hk.speedUp);
      const speedDown = !speedUp && matchesHotkeyArray(ev, hk.speedDown);
      const reset = !speedUp && !speedDown && matchesHotkeyArray(ev, hk.resetSpeed);
      const toggle = !speedUp && !speedDown && !reset && matchesHotkeyArray(ev, hk.toggleLast);
      const seekFwd =
        !speedUp && !speedDown && !reset && !toggle && matchesHotkeyArray(ev, hk.seekForward);
      const seekBack =
        !speedUp &&
        !speedDown &&
        !reset &&
        !toggle &&
        !seekFwd &&
        matchesHotkeyArray(ev, hk.seekBack);
      if (!speedUp && !speedDown && !reset && !toggle && !seekFwd && !seekBack) return;
      const step = settingsStore.getKey('speedStep') ?? SPEED_STEP;
      const v = ctx.discovery.resolve('video') as HTMLVideoElement | null;
      if (!v) return;
      ev.preventDefault();
      if (speedUp) {
        void setTemporary(ctx, v.playbackRate + step);
      } else if (speedDown) {
        void setTemporary(ctx, v.playbackRate - step);
      } else if (reset) {
        // FEAT-011: one keypress back to normal speed (temporary — the
        // saved default is untouched, same semantics as a button click).
        toggleLastSpeed = v.playbackRate;
        void setTemporary(ctx, 1);
      } else if (toggle) {
        // FEAT-012: swap current ↔ remembered. First press with no
        // memory falls back to 1×.
        const target = toggleLastSpeed ?? 1;
        toggleLastSpeed = v.playbackRate;
        void setTemporary(ctx, target);
      } else if (seekFwd || seekBack) {
        // FEAT-014: relative seek. Clamp into [0, duration].
        const span = settingsStore.getKey('seekSeconds') ?? 10;
        const delta = seekFwd ? span : -span;
        try {
          const dur = Number.isFinite(v.duration) ? v.duration : Number.POSITIVE_INFINITY;
          v.currentTime = Math.min(Math.max(0, v.currentTime + delta), dur);
        } catch (e) {
          ctx.logger.warn('hotkey seek failed', e);
        }
      }
    },
    { capture: true },
  );

  // 12. HDRezka site-specific reattach. Triggered when a new <video>
  //     element appears (episode change inside Plyr, ad-roll insertion,
  //     fullscreen mode reattach).
  const reattach = (): void => {
    // Audit 2026-05-09 sec C8: bail if the outer cleanup has disposed —
    // a late-arriving navigation event would otherwise create a fresh
    // attachCleanup registry that never gets disposed, leaking listeners.
    if (cleanup.isDisposed) return;
    attachCleanup.dispose();
    attachCleanup = new CleanupRegistry();
    for (const v of document.querySelectorAll('video')) {
      delete (v as HTMLVideoElement & { __vsAttached?: boolean }).__vsAttached;
    }
    void ctx.speedStore.setSmart(null);
    // FEAT-015: bf-cache/popstate can land on a different title.
    ctx.speedStore.setActiveMemoryKey(extractHDRezkaTitleId(location.pathname));

    panel.element.parentElement?.removeChild(panel.element);
    scheduleInsertWithRetry(panel.element, ctx);
    attachToVideo(ctx, meter, attachCleanup, 0, resumeHooks);
    reapplyTheme();
  };
  bootstrapHDRezkaSite(ctx).onNavigation(reattach);

  // 12a. bf-cache restore + browser back/forward navigation.
  ctx.cleanup.addEventListener(window, 'pageshow', (event) => {
    const ev = event as PageTransitionEvent;
    if (ev.persisted) {
      ctx.logger.info('pageshow: bf-cache restore, forcing reattach');
      reattach();
    }
  });
  ctx.cleanup.addEventListener(window, 'popstate', () => {
    ctx.logger.debug('popstate: forcing reattach');
    reattach();
  });

  // 12b. Re-parent the speed-popup into the fullscreen element so it
  //      stays visible during fullscreen playback.
  cleanup.add(installFullscreenReparent(() => discoveryPort.resolve('playerContainer')));

  // 12c. Re-integrate the slider into player chrome on fullscreen
  //      transitions, AND reparent the entire panel root into the
  //      fullscreenElement when it lives outside the player wrapper.
  //
  //      Browser fullscreen (`Element.requestFullscreen()`) renders ONLY
  //      the fullscreenElement's subtree. With sliderPosition='right' or
  //      'bottom', the panel lives next-to / below the player wrapper —
  //      i.e., outside the wrapper — so it disappears from view in
  //      fullscreen unless we move it in. v0.3.5 audit MAJ-9.
  let panelOrigParent: Element | null = null;
  let panelOrigNext: Node | null = null;
  ctx.cleanup.addEventListener(document, 'fullscreenchange', () => {
    const fs = document.fullscreenElement;
    const panelEl = panel.element;

    if (fs && !fs.contains(panelEl)) {
      // Entering fullscreen. Remember where the panel was so we can
      // put it back on exit.
      if (panelEl.parentElement) {
        panelOrigParent = panelEl.parentElement;
        panelOrigNext = panelEl.nextSibling;
      }
      try {
        fs.appendChild(panelEl);
      } catch (e) {
        ctx.logger.warn('fullscreen: panel reparent failed', e);
      }
    } else if (!fs && panelOrigParent) {
      // Exiting fullscreen. Restore the panel to its original spot.
      // Audit 2026-05-11 W6.2 (REL-013): if the original parent was
      // detached during fullscreen (e.g. episode change while
      // fullscreen), restoring there orphans the panel — its
      // sibling-watcher's parent is the same detached node and
      // won't fire. Fall back to scheduleInsertWithRetry.
      const origStillLive = document.contains(panelOrigParent);
      try {
        if (origStillLive && panelOrigNext && panelOrigNext.parentNode === panelOrigParent) {
          panelOrigParent.insertBefore(panelEl, panelOrigNext);
        } else if (origStillLive) {
          panelOrigParent.appendChild(panelEl);
        } else {
          ctx.logger.warn('fullscreen: original parent detached, rescheduling insert');
          scheduleInsertWithRetry(panelEl, ctx);
        }
      } catch (e) {
        ctx.logger.warn('fullscreen: panel restore failed, rescheduling insert', e);
        scheduleInsertWithRetry(panelEl, ctx);
      }
      panelOrigParent = null;
      panelOrigNext = null;
    }

    // The slider-in-chrome integration ('video' position) is unaffected
    // by the reparent above (the slider lives inside the player wrapper
    // when this position is active, so it's already in the fullscreen
    // subtree). applyLayout still fires to recompute slider geometry
    // after the chrome resizes.
    if (ctx.settingsStore.getKey('sliderPosition') === 'video') {
      ctx.cleanup.setTimeout(() => panel.applyLayout(), 500);
    }
  });

  // 13. Start health watchdog.
  healthChecker.start();
  cleanup.add(
    healthChecker.subscribe((report) => {
      // REL-035: a throw inside the render path must not kill the
      // subscription — otherwise one bad rerender silences the health
      // indicator (gear dot) for the rest of the page lifetime.
      try {
        panel.rerenderSettings();
        panel.setGearWarning(!report.healthy);
      } catch (e) {
        logger.warn('health subscriber render failed', e);
      }
      logger.debug('health:', report.healthy ? 'ok' : 'warn');
    }),
  );

  // 14. Message listener for the toolbar popup. The popup runs in a
  //     separate context with no access to HealthChecker / SelectorCache,
  //     so when the user opens it on a video page it asks the active tab
  //     (which is us) to run the diagnostic and stream the result back.
  //     This lets the popup show a LIVE status instead of the static
  //     "Not checked yet" placeholder.
  let ourRuntimeId: string | null = null;
  const onPopupMessage = async (
    msg: unknown,
    sender?: { id?: string; tab?: { id?: number } },
  ): Promise<{ ok: boolean; report?: DiagnosticReport; error?: string; speed?: number }> => {
    // Sender validation (audit 2026-05-09 sec C4): reject messages from
    // foreign extensions and from in-page content scripts. ourRuntimeId
    // is captured below when the listener is installed.
    if (sender?.id && ourRuntimeId && sender.id !== ourRuntimeId) {
      return { ok: false, error: 'foreign_sender' };
    }
    if (sender?.tab !== undefined) {
      return { ok: false, error: 'tab_sender_blocked' };
    }
    const m = msg as { type?: string } | null | undefined;
    if (!m || typeof m.type !== 'string') {
      return Promise.resolve({ ok: false, error: 'no_type' });
    }
    try {
      switch (m.type) {
        case 'vs:recheck': {
          const report = healthChecker.runOnce();
          return Promise.resolve({ ok: true, report });
        }
        case 'vs:get-status': {
          const report = healthChecker.getLastReport() ?? healthChecker.runOnce();
          return Promise.resolve({ ok: true, report });
        }
        case 'vs:purge-cache': {
          // Await: the popup shows success/failure based on this resolved
          // value. Without await a real adapter failure would surface as
          // ok=true and the user would think the purge succeeded.
          await cache.purgeAll();
          return Promise.resolve({ ok: true });
        }
        // FEAT-021: popup quick actions — read/apply the live speed of
        // the video in THIS tab without opening the in-player menu.
        case 'vs:get-speed': {
          const v = ctx.discovery.resolve('video') as HTMLVideoElement | null;
          if (!(v instanceof HTMLVideoElement)) {
            return Promise.resolve({ ok: false, error: 'no_video' });
          }
          return Promise.resolve({
            ok: true,
            speed: v.playbackRate,
          } as { ok: boolean; speed?: number });
        }
        case 'vs:set-speed': {
          const speed = (msg as { speed?: unknown }).speed;
          if (typeof speed !== 'number' || !Number.isFinite(speed)) {
            return Promise.resolve({ ok: false, error: 'bad_speed' });
          }
          const v = ctx.discovery.resolve('video') as HTMLVideoElement | null;
          if (!(v instanceof HTMLVideoElement)) {
            return Promise.resolve({ ok: false, error: 'no_video' });
          }
          await setTemporary(ctx, speed);
          return Promise.resolve({ ok: true, speed: v.playbackRate } as {
            ok: boolean;
            speed?: number;
          });
        }
        default:
          return Promise.resolve({ ok: false, error: 'unknown_type' });
      }
    } catch (e) {
      return Promise.resolve({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };
  // Dynamic import keeps wxt/browser out of the userscript bundle (the
  // userscript build aliases it to a throwing shim). isDisposed guard
  // (audit 2026-05-09 C7): without it, a fast HMR/cleanup-before-resolve
  // race would call `cleanup.add()` after dispose and throw via assertLive.
  void import('wxt/browser').then(({ browser: br }) => {
    if (cleanup.isDisposed) return;
    try {
      ourRuntimeId = br.runtime.id ?? null;
      br.runtime.onMessage.addListener(onPopupMessage);
      cleanup.add(() => {
        try {
          br.runtime.onMessage.removeListener(onPopupMessage);
        } catch {
          /* swallow */
        }
      });
    } catch (e) {
      logger.warn('popup message listener install failed', e);
    }
  });

  // Remember where we successfully activated so the popup's "Open HDRezka"
  // can jump straight to the last-known-good mirror when no rezka tab is
  // open. Fire-and-forget; junk hosts are dropped inside the writer.
  void writeLastWorkingHost(adapter, location.hostname);

  logger.info('bootstrap complete');
}

/**
 * Auto-follow signature gate with bounded retry (part B). detectSite is
 * name-based and settles synchronously, but on an auto-follow host the DOM
 * signature IS the gate — and HDRezka's player markers aren't guaranteed to
 * be in the DOM the instant document_idle fires. Mirror the retry discipline
 * used elsewhere in this file: resolve true as soon as looksLikeHDRezka()
 * passes, or false once the budget elapses (or the context is invalidated).
 * Resolves instantly when the signature is already present, so a real rezka
 * page pays no delay; only auto-follow hosts ever reach this.
 */
function awaitHDRezkaSignature(
  wxtCtx: ContentScriptContext,
  budgetMs = 3000,
  stepMs = 250,
): Promise<boolean> {
  if (looksLikeHDRezka()) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let elapsed = 0;
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setInterval(() => {
      if (settled) {
        clearInterval(timer);
        return;
      }
      if (looksLikeHDRezka()) {
        clearInterval(timer);
        finish(true);
        return;
      }
      elapsed += stepMs;
      if (elapsed >= budgetMs) {
        clearInterval(timer);
        finish(false);
      }
    }, stepMs);
    // A mid-wait navigation / HMR must not hang bootstrap or let it continue
    // on a dead context — resolve false so the caller aborts cleanly.
    wxtCtx.onInvalidated(() => finish(false));
  });
}

/**
 * FEAT-018/20: a durable failure chip (warn ✕ + a "Reload" action) for the
 * two terminal give-up paths. Replaces the auto-dismissing 3s warn toast so
 * the message — and its recovery action — stays put until the user acts.
 */
function showFailureChip(ctx: AppContext, message: string): void {
  try {
    showActionChip(message, {
      kind: 'warn',
      icon: 'alert',
      dismissLabel: ctx.i18n.t('chip.dismiss'),
      action: { label: ctx.i18n.t('chip.reload'), onClick: () => location.reload() },
      playerContainer: ctx.discovery.resolve('playerContainer'),
    });
  } catch (e) {
    ctx.logger.warn('failure chip render failed', e);
  }
}

function scheduleInsertWithRetry(panelEl: HTMLElement, ctx: AppContext): void {
  const MAX_ATTEMPTS = 16;
  const BASE_DELAY = 500;
  const MAX_DELAY = 5000;
  const BACKOFF = 1.5;
  let attempts = 0;
  let delay = BASE_DELAY;
  let observerInstalled = false;

  function tryOnce(): void {
    attempts += 1;
    let result: ReturnType<typeof insertPanel>;
    try {
      result = insertPanel(panelEl, ctx);
    } catch (e) {
      ctx.logger.warn(`insertPanel threw on attempt ${attempts}`, e);
      result = { parent: null, anchor: 'no-anchor' as const };
    }
    const inDoc = document.contains(panelEl);
    const placed = result.anchor !== 'no-anchor' && inDoc;

    if (placed && !result.tentative) {
      ctx.logger.info(`panel inserted via ${result.anchor} on attempt ${attempts}`);
      if (!observerInstalled) {
        installRemovalObserver(panelEl, ctx, scheduleInsertWithRetry);
        observerInstalled = true;
      }
      return;
    }

    if (placed && result.tentative) {
      ctx.logger.debug(
        `panel tentatively at ${result.anchor} on attempt ${attempts}; continuing retry for preferred anchor`,
      );
    }

    if (attempts >= MAX_ATTEMPTS) {
      if (placed) {
        ctx.logger.info(
          `panel finalized via tentative anchor ${result.anchor} after ${attempts} attempts`,
        );
        if (!observerInstalled) {
          installRemovalObserver(panelEl, ctx, scheduleInsertWithRetry);
          observerInstalled = true;
        }
      } else {
        ctx.logger.warn(
          `panel insertion failed after ${attempts} attempts; giving up until next reattach`,
        );
        // Surface this to the user. Silent failure left the page with no
        // gear, no notification, no explanation. A durable chip (with a
        // Reload action that kicks the retry cycle from scratch) stays put
        // instead of vanishing in 3s. It lives in the page body, so it
        // appears even when the panel itself never landed.
        showFailureChip(ctx, ctx.i18n.t('panel.insertion_failed'));
      }
      return;
    }
    ctx.cleanup.setTimeout(tryOnce, delay);
    delay = Math.min(MAX_DELAY, Math.round(delay * BACKOFF));
  }
  tryOnce();
}

function installRemovalObserver(
  panelEl: HTMLElement,
  ctx: AppContext,
  reschedule: (panel: HTMLElement, ctx: AppContext) => void,
): void {
  const parent = panelEl.parentElement;
  if (!parent) return;
  // Audit 2026-05-11 W2.3 (REL-006): port VS idempotency brand. Without
  // this guard, rapid episode-change / ad-roll mutation bursts on
  // HDRezka schedule overlapping insert chains that each install a
  // sibling observer on the same parent — every childList mutation
  // then fires the callback N times. Mirror of VideoSpeeds:760-817.
  type Branded = Element & { __vsRemovalObserverPanel?: HTMLElement };
  if ((parent as Branded).__vsRemovalObserverPanel === panelEl) return;
  (parent as Branded).__vsRemovalObserverPanel = panelEl;
  ctx.cleanup.add(() => {
    if ((parent as Branded).__vsRemovalObserverPanel === panelEl) {
      delete (parent as Branded).__vsRemovalObserverPanel;
    }
  });
  let lastPrev: Element | null = panelEl.previousElementSibling;
  const observer = new MutationObserver(() => {
    if (panelEl.parentNode !== parent || !document.contains(panelEl)) {
      ctx.logger.info('panel removed from DOM by host page; re-inserting');
      observer.disconnect();
      reschedule(panelEl, ctx);
      return;
    }
    const currentPrev = panelEl.previousElementSibling;
    if (currentPrev === lastPrev) return;
    lastPrev = currentPrev;
    try {
      insertPanel(panelEl, ctx);
      lastPrev = panelEl.previousElementSibling;
    } catch (e) {
      ctx.logger.warn('insertPanel re-run after sibling change failed', e);
    }
  });
  observer.observe(parent, { childList: true });
  ctx.cleanup.addObserver(observer);
}

/** FEAT-018: per-attach resume hook (position tracking + resume chip),
 *  injected by the orchestrator so attachToVideo stays storage-agnostic. */
interface ResumeHooks {
  onVideoReady(v: HTMLVideoElement, attachCleanup: CleanupRegistry): void;
}

/**
 * Apply the chosen initial speed once the video element is ready, install
 * a ratechange listener, AND fight Plyr-driven playbackRate resets.
 */
function attachToVideo(
  ctx: AppContext,
  meter: ReturnType<typeof createRatechangeMeter>,
  cleanup: CleanupRegistry,
  attempt = 0,
  resume?: ResumeHooks,
): void {
  const v = ctx.discovery.resolve('video');
  if (!(v instanceof HTMLVideoElement)) {
    // Audit 2026-05-11 W6.1 (REL-012): cap with exponential backoff.
    // 20 attempts, 500 ms × 1.2^attempt, max 5 s. The orchestrator
    // re-arms on every episode change / reattach so giving up here
    // is bounded.
    if (attempt >= 20) {
      ctx.logger.warn('attachToVideo: gave up after 20 attempts; will re-arm on next reattach');
      // REL-039: tell the user instead of failing silently. The retry
      // budget spans ~80 s, so this only fires on genuinely broken pages.
      // Durable chip with a Reload action (FEAT-018/20).
      showFailureChip(ctx, ctx.i18n.t('panel.video_not_found'));
      return;
    }
    const delay = Math.min(5000, Math.round(500 * 1.2 ** attempt));
    cleanup.setTimeout(() => attachToVideo(ctx, meter, cleanup, attempt + 1, resume), delay);
    return;
  }
  type Branded = HTMLVideoElement & { __vsAttached?: boolean; __vsSelfWriteAt?: number };
  if ((v as Branded).__vsAttached) return;
  (v as Branded).__vsAttached = true;

  void ctx.speedStore.setSmart(null);

  // FEAT-018: arm position tracking + the resume offer for this element.
  resume?.onVideoReady(v, cleanup);

  // FEAT-017: re-apply the user's volume boost to the fresh element.
  // No-op (and no audio graph) while the setting sits at 100%.
  const boost = ctx.settingsStore.getKey('volumeBoost');
  if (typeof boost === 'number' && boost > 1.001) {
    applyVolumeBoost(v, boost, ctx.logger);
  }

  let lastSrc = v.currentSrc || v.src || '';
  let isSelfWrite = false;

  const isFreshSelfWrite = (): boolean => {
    const ts = (v as Branded).__vsSelfWriteAt ?? 0;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    // REL-036: bound the delta on both sides. A timer glitch (suspend /
    // resume, clock source change) can make `now - ts` negative or huge;
    // either way the stamp is not "fresh", so fall through to the normal
    // revert path instead of treating a foreign write as ours.
    const delta = now - ts;
    return delta >= 0 && delta < SELF_WRITE_GRACE_MS;
  };

  const apply = (reason: string): void => {
    const target = pickInitialSpeed(ctx);
    if (Math.abs(v.playbackRate - target) < 0.005) return;
    // Use applyTransient (no storage write) — storage already holds the
    // value we're applying; pickInitialSpeed READS it. Before this change
    // each retry tick called setSpeed, which wrote to storage twice. With
    // 4 retries per attach × 2 writes = 8 storage writes per video attach,
    // and src-change events fired the cascade again. ratechange-revert
    // protection still works via __vsSelfWriteAt timestamp set inside
    // applyToVideo + isFreshSelfWrite() check.
    isSelfWrite = true;
    try {
      applyTransient(ctx, target, { silent: true });
    } finally {
      isSelfWrite = false;
    }
    ctx.logger.debug(`attachToVideo: re-applying ${target}x (${reason})`);
  };

  if (v.readyState >= 1) {
    apply('ready');
  } else {
    cleanup.addEventListener(v, 'loadedmetadata', () => apply('loadedmetadata'), { once: true });
  }
  // HDRezka uses HLS via Plyr — the player races our restore on every
  // segment / quality switch. Schedule extra applies during the first
  // second after attach.
  for (const ms of [100, 300, 500, 1000]) {
    cleanup.setTimeout(() => apply(`retry+${ms}ms`), ms);
  }

  let prev = v.playbackRate;
  cleanup.addEventListener(v, 'ratechange', () => {
    const next = v.playbackRate;
    // REL-034: transitions through rate=0 are player lifecycle noise
    // (HLS buffering, pause mechanics), not the site fighting our speed.
    // Counting them inflates perMinute() and can trip the rate-storm
    // check on perfectly healthy pages.
    if (!isSelfWrite && !isFreshSelfWrite() && prev > 0 && next > 0) {
      meter.tick(prev, next);
    }
    prev = next;
    if (isSelfWrite || isFreshSelfWrite()) return;
    const target = pickInitialSpeed(ctx);
    if (Math.abs(next - target) <= 0.005) return;

    // HDRezka / Plyr is reverting; counter-revert after a microtask so we
    // break out of the ratechange callback's current task. Routed through
    // the per-attach cleanup registry so an episode change that disposes
    // the attach also kills any in-flight revert before it can fire on
    // the next episode's video element.
    cleanup.setTimeout(() => apply('ratechange-revert'), 50);
  });

  cleanup.addEventListener(v, 'playing', () => {
    if (isSelfWrite || isFreshSelfWrite()) return;
    const target = pickInitialSpeed(ctx);
    if (Math.abs(v.playbackRate - target) > 0.005) {
      apply('playing-revert');
    }
  });

  cleanup.addEventListener(v, 'loadstart', () => {
    const nowSrc = v.currentSrc || v.src || '';
    if (nowSrc && nowSrc !== lastSrc) {
      lastSrc = nowSrc;
      void ctx.speedStore.setSmart(null);
      for (const ms of [100, 300, 500, 1000]) {
        cleanup.setTimeout(() => apply(`src-change+${ms}ms`), ms);
      }
    }
  });
}

function shouldSkipHotkey(ev: KeyboardEvent): boolean {
  const target = ev.target as Element | null;
  if (target instanceof HTMLInputElement) {
    const t = target.type.toLowerCase();
    if (
      t === 'text' ||
      t === 'search' ||
      t === 'url' ||
      t === 'email' ||
      t === 'password' ||
      t === 'number' ||
      t === 'tel'
    ) {
      return true;
    }
  }
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  if (target?.classList.contains('vs-hotkey-input')) return true;
  const sel = window.getSelection?.();
  if (sel && sel.toString().length > 0) return true;
  return false;
}
