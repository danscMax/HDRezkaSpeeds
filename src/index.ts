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
import { detectSite, isHDRezkaVideoPath } from './sites/detect';
import { bootstrapHDRezkaSite, patchPlyrLocalStorage } from './sites/hdrezka';
import {
  applyTransient,
  pickInitialSpeed,
  SELF_WRITE_GRACE_MS,
  setTemporary,
} from './speed/controller';
import { matchesHotkeyArray } from './speed/hotkeys';
import { createRatechangeMeter } from './speed/meter';
import { createBrowserStorageAdapter, type StorageAdapter } from './storage/adapter';
import { runTmMigration } from './storage/migration-tm';
import { createSettingsStore } from './storage/settings-store';
import { createSpeedStore } from './storage/speed-store';
import { createPanel, createUiPort, injectStyles, insertPanel, installThemeWatcher } from './ui';
import { showNotification } from './ui/notifications';
import { installFullscreenReparent } from './ui/popup';
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
  // 0. Site detection.
  const site = detectSite();
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

  // 2. Storage stores.
  const adapter = options.adapter ?? createBrowserStorageAdapter();
  const settingsStore = createSettingsStore(adapter);
  const speedStore = createSpeedStore(adapter);
  await settingsStore.init(site);
  await speedStore.init(site);

  // 3. Discovery.
  const cache = createSelectorCache(adapter, {
    scriptVersion: SCRIPT_VERSION,
  });
  await cache.hydrate();
  const discoveryEngine = createDiscoveryEngine({
    site,
    cache,
    validators: Validators,
    isFullChainEnabled: () => killSwitch.isDiscoveryEnabled(),
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
  const killSwitch = createKillSwitch(ctx);
  const healthChecker = createHealthChecker({
    ctx,
    scriptVersion: SCRIPT_VERSION,
    discovery: discoveryEngine,
    meter,
    killSwitch: killSwitch.snapshot,
    selectorCache: cache,
    isHealthCheckEnabled: killSwitch.isHealthCheckEnabled,
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

  // 7. Inject styles, build panel, build real UiPort.
  injectStyles(site);
  const panel = createPanel({
    ctx,
    scriptVersion: SCRIPT_VERSION,
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
  const realUi = createUiPort({
    panel,
    playerContainer: () => discoveryPort.resolve('playerContainer'),
  });
  ctx.ui = realUi;
  cleanup.add(() => panel.dispose());

  const offSettingsSub = settingsStore.subscribe((next) => {
    if (next.language !== lang) {
      lang = next.language;
      ctx.i18n = createTranslator(next.language);
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

  const persistTheme = (): void => {
    const theme = document.documentElement.dataset.vsTheme;
    if (theme !== 'dark' && theme !== 'light') return;
    if (settingsStore.getKey('lastSeenTheme') === theme) return;
    void settingsStore.update({ lastSeenTheme: theme }).catch(() => {
      /* fire-and-forget */
    });
  };
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

  // 10. Attach to <video>. Nested CleanupRegistry per attach so we can
  //     dispose the ratechange/loadstart listeners cleanly when HDRezka
  //     mounts a new <video> on episode change.
  let attachCleanup = new CleanupRegistry();
  cleanup.add(() => attachCleanup.dispose());
  attachToVideo(ctx, meter, attachCleanup);

  // 11. Hotkey listener (global, capture so it wins over the page).
  ctx.cleanup.addEventListener(
    document,
    'keydown',
    (event) => {
      const ev = event as KeyboardEvent;
      if (shouldSkipHotkey(ev)) return;
      const hk = settingsStore.getKey('hotkeys');
      const step = settingsStore.getKey('speedStep') ?? SPEED_STEP;
      const v = ctx.discovery.resolve('video') as HTMLVideoElement | null;
      if (matchesHotkeyArray(ev, hk.speedUp)) {
        ev.preventDefault();
        if (v) void setTemporary(ctx, v.playbackRate + step);
      } else if (matchesHotkeyArray(ev, hk.speedDown)) {
        ev.preventDefault();
        if (v) void setTemporary(ctx, v.playbackRate - step);
      }
    },
    { capture: true },
  );

  // 12. HDRezka site-specific reattach. Triggered when a new <video>
  //     element appears (episode change inside Plyr, ad-roll insertion,
  //     fullscreen mode reattach).
  const reattach = (): void => {
    attachCleanup.dispose();
    attachCleanup = new CleanupRegistry();
    for (const v of document.querySelectorAll('video')) {
      delete (v as HTMLVideoElement & { __vsAttached?: boolean }).__vsAttached;
    }
    void ctx.speedStore.setSmart(null);

    panel.element.parentElement?.removeChild(panel.element);
    scheduleInsertWithRetry(panel.element, ctx);
    attachToVideo(ctx, meter, attachCleanup);
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
      try {
        if (panelOrigNext && panelOrigNext.parentNode === panelOrigParent) {
          panelOrigParent.insertBefore(panelEl, panelOrigNext);
        } else {
          panelOrigParent.appendChild(panelEl);
        }
      } catch (e) {
        ctx.logger.warn('fullscreen: panel restore failed', e);
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
      panel.rerenderSettings();
      panel.setGearWarning(!report.healthy);
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
  ): Promise<{ ok: boolean; report?: DiagnosticReport; error?: string }> => {
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

  logger.info('bootstrap complete');
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
        // gear, no notification, no explanation. Now they get a hint to
        // try a reload (which kicks the retry cycle from scratch). The
        // toast lives in the page's body, so it appears even when the
        // panel itself never landed.
        try {
          ctx.ui.showNotification(ctx.i18n.t('panel.insertion_failed'), 'warn');
        } catch (e) {
          ctx.logger.warn('panel.insertion_failed notification failed', e);
        }
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

/**
 * Apply the chosen initial speed once the video element is ready, install
 * a ratechange listener, AND fight Plyr-driven playbackRate resets.
 */
function attachToVideo(
  ctx: AppContext,
  meter: ReturnType<typeof createRatechangeMeter>,
  cleanup: CleanupRegistry,
): void {
  const v = ctx.discovery.resolve('video');
  if (!(v instanceof HTMLVideoElement)) {
    cleanup.setTimeout(() => attachToVideo(ctx, meter, cleanup), 500);
    return;
  }
  type Branded = HTMLVideoElement & { __vsAttached?: boolean; __vsSelfWriteAt?: number };
  if ((v as Branded).__vsAttached) return;
  (v as Branded).__vsAttached = true;

  void ctx.speedStore.setSmart(null);

  let lastSrc = v.currentSrc || v.src || '';
  let isSelfWrite = false;

  const isFreshSelfWrite = (): boolean => {
    const ts = (v as Branded).__vsSelfWriteAt ?? 0;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return now - ts < SELF_WRITE_GRACE_MS;
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
    if (!isSelfWrite && !isFreshSelfWrite()) {
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
