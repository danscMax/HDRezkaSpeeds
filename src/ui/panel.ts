/**
 * Builds the in-player panel: speed buttons row + slider + gear (settings)
 * button + (lazy-mounted) settings modal. Returns a control surface the
 * UiPort impl wraps to fulfil the Wave 1.7 controller's calls.
 *
 * The panel is created BEFORE the AppContext is fully assembled (to avoid
 * the chicken-and-egg between AppContext.ui and UiPort impl construction).
 * Therefore we receive the bits we need (settings/speed stores, cleanup,
 * i18n, discovery, the click router from the speed controller) directly,
 * and the orchestrator (Wave 1.10) wires the UiPort hook afterwards.
 */

import { CleanupRegistry } from '../app/cleanup';
import type { AppContext } from '../app/context';
import { defaultPresetsFor, speedBoundsFor } from '../config';
import { applyTransient, handleSpeedButtonClick, setSpeed } from '../speed/controller';
import { refreshActiveButton, refreshPinnedButton, renderButtonsRow } from './buttons';
import { vsFilledGearIcon } from './icons';
import { disposeNotificationStack } from './notifications';
import { disposeSpeedPopup } from './popup';
import { refreshDiagnosticStatus } from './settings/diag-status';
import { attachSettingsHandlers } from './settings/handlers';
import { type ActiveTab, renderSettingsMenu } from './settings/modal';
import { renderSlider, setSliderRange, setSliderValue, updateSliderFill } from './slider';

/** Diag-action sink. The orchestrator passes a real implementation that
 *  can purge cache, copy report, or trip the KillSwitch. */
export interface DiagActions {
  recheck(): void;
  copyReport(): Promise<boolean>;
  purgeCache(): Promise<void>;
  fullReset(): Promise<void>;
}

/** KillSwitch read/write, surfaced through the panel so the settings
 *  modal can bind discovery/healthcheck toggles. */
export interface KillSwitchControl {
  isDiscoveryEnabled(): boolean;
  isHealthCheckEnabled(): boolean;
  setDiscoveryEnabled(on: boolean): Promise<void>;
  setHealthCheckEnabled(on: boolean): Promise<void>;
}

export interface PanelHandle {
  /** The root DOM node to insert into the player. */
  element: HTMLElement;
  /** Call after the speed changes (sync; no DOM thrash). */
  refreshButtons: (speed: number) => void;
  refreshSlider: (speed: number) => void;
  /** Re-render the settings modal contents (after a setting change). */
  rerenderSettings: () => void;
  /** Apply layout changes (slider position toggled). */
  applyLayout: () => void;
  /** Toggle the red warning dot on the gear icon. Wired by the
   *  orchestrator's HealthChecker subscription so the user sees a
   *  visual cue that diagnostics found a problem (audit A3.1). */
  setGearWarning: (on: boolean) => void;
  dispose: () => void;
}

export interface CreatePanelOptions {
  ctx: AppContext;
  scriptVersion: string;
  /** Custom preset list per site; falls back to DEFAULT_PRESETS. */
  presets?: readonly number[];
  /** Real KillSwitch handle. Populated by the orchestrator (Wave 1.10);
   *  the popup builds a stub that returns true/no-ops. */
  killSwitch?: KillSwitchControl;
  /** Diagnostic action sink. Defaults to no-ops when not provided. */
  diagActions?: DiagActions;
}

export function createPanel(opts: CreatePanelOptions): PanelHandle {
  const { ctx, scriptVersion } = opts;
  const bounds = speedBoundsFor(ctx.site);
  const killSwitch = opts.killSwitch;
  const diagActions = opts.diagActions;

  /**
   * Resolve the current preset list. User can customise via Settings →
   * General → "Speed buttons", which writes to `Settings.speedPresets`.
   * Falls back to the per-site default if the explicit `opts.presets`
   * override is absent AND the user's settings list is empty (which can
   * happen after a botched import or a "remove all" click).
   */
  const resolvePresets = (): readonly number[] => {
    if (opts.presets && opts.presets.length > 0) return opts.presets;
    const stored = ctx.settingsStore.getKey('speedPresets');
    if (Array.isArray(stored) && stored.length > 0) return stored;
    return defaultPresetsFor(ctx.site);
  };

  const root = document.createElement('div');
  root.className = 'vs-panel';
  root.dataset.vsSite = ctx.site;

  // Pinned = the saved/default speed when rememberSpeed is on. Used
  // to decorate that button with a small dot so the user sees which
  // speed will be applied to fresh videos.
  const computePinnedSpeed = (): number | null => {
    return ctx.settingsStore.getKey('rememberSpeed') === true ? ctx.speedStore.current() : null;
  };

  const buttonsRow = renderButtonsRow({
    speeds: resolvePresets(),
    current: ctx.speedStore.current(),
    pinned: computePinnedSpeed(),
    buttonTitle: ctx.i18n.t('panel.button.tooltip'),
  });
  /**
   * Resolve the user's slider range. Falls back to site bounds when the
   * user hasn't set a custom value or the stored value is incoherent
   * relative to the site (e.g. a TM-imported sliderMin that's below
   * what the site supports).
   */
  const resolveSliderRange = (): { min: number; max: number } => {
    const storedMin = ctx.settingsStore.getKey('sliderMin');
    const storedMax = ctx.settingsStore.getKey('sliderMax');
    const min =
      typeof storedMin === 'number' && storedMin >= bounds.min && storedMin < bounds.max
        ? storedMin
        : bounds.min;
    const max =
      typeof storedMax === 'number' && storedMax > min && storedMax <= bounds.max
        ? storedMax
        : bounds.max;
    return { min, max };
  };
  const initialRange = resolveSliderRange();
  const sliderContainer = renderSlider({
    current: ctx.speedStore.current(),
    min: initialRange.min,
    max: initialRange.max,
  });

  const gearWrapper = document.createElement('div');
  gearWrapper.className = 'vs-gear-wrapper';
  const gearBtn = document.createElement('button');
  gearBtn.type = 'button';
  gearBtn.className = 'vs-gear-button';
  // aria-label for screen readers; title gives the same affordance to
  // sighted hover users.
  gearBtn.setAttribute('aria-label', ctx.i18n.t('menu.title'));
  // Audit 2026-05-09 a11y Q1: dialog with form inputs, not menu.
  gearBtn.setAttribute('aria-haspopup', 'dialog');
  gearBtn.setAttribute('aria-expanded', 'false');
  gearBtn.title = ctx.i18n.t('menu.title');
  gearBtn.appendChild(vsFilledGearIcon(16));

  const settingsMenu = document.createElement('div');
  settingsMenu.className = 'settings-menu';
  settingsMenu.setAttribute('role', 'dialog');
  settingsMenu.setAttribute('aria-modal', 'false');
  settingsMenu.setAttribute('aria-label', ctx.i18n.t('menu.title'));
  settingsMenu.setAttribute('aria-hidden', 'true');

  gearWrapper.appendChild(gearBtn);
  gearWrapper.appendChild(settingsMenu);

  // Brand marker removed in 0.3.7 — the chevrons-up icon was a purely
  // decorative "this is the extension" identity hint that users found
  // confusing and inert (no click target, no meaning). The gear button
  // is identity enough; users who want to verify which extension drew
  // the panel can hover the gear (its title attribute names the
  // extension).
  root.appendChild(buttonsRow);
  root.appendChild(sliderContainer);
  root.appendChild(gearWrapper);

  // ----- Tab state preserved across rerenders -----
  let activeTab: ActiveTab = 'general';

  // ----- Click handlers on speed buttons -----
  ctx.cleanup.addEventListener(buttonsRow, 'click', (event) => {
    const target = event.target as HTMLElement | null;
    const btn = target?.closest<HTMLButtonElement>('.speed-button');
    if (!btn) return;
    const speed = parseFloat(btn.dataset.vsSpeed ?? '');
    if (Number.isFinite(speed)) {
      handleSpeedButtonClick(ctx, speed);
    }
  });

  // ----- Slider input -----
  // Drag goes through plain setSpeed(), NOT through handleSpeedButtonClick.
  // The click router has a 400ms debounce counter that increments on every
  // tick; routing slider 'input' events through it counted each pixel of
  // drag as another click and after 2 ticks force-promoted the drag to
  // setGlobal (toast + force-enabled rememberSpeed) -- regression flagged
  // by Wave A audit. Original userscript at .user.js:4817-4821 also
  // sidesteps the click semantics for slider drag.
  const sliderInput = sliderContainer.querySelector<HTMLInputElement>('.speed-slider');
  if (sliderInput) {
    // Drag is rAF-coalesced applyTransient (no storage write per pixel),
    // and persistence happens once on `change` (release). Before this
    // split, every `input` event triggered setSpeed → 2 storage writes,
    // and a 2-second drag at 60–120 events/sec blew through Chrome's
    // 120-writes-per-minute storage quota in under 1.5s.
    let pendingRaf: number | null = null;
    let pendingSpeed: number | null = null;
    ctx.cleanup.addEventListener(sliderInput, 'input', () => {
      const value = parseFloat(sliderInput.value);
      if (!Number.isFinite(value)) return;
      // Visual fill is cheap; do it every event for buttery feedback.
      updateSliderFill(sliderInput);
      pendingSpeed = value;
      if (pendingRaf !== null) return;
      pendingRaf = requestAnimationFrame(() => {
        pendingRaf = null;
        if (pendingSpeed !== null) {
          applyTransient(ctx, pendingSpeed);
          pendingSpeed = null;
        }
      });
    });
    ctx.cleanup.addEventListener(sliderInput, 'change', () => {
      if (pendingRaf !== null) {
        cancelAnimationFrame(pendingRaf);
        pendingRaf = null;
      }
      pendingSpeed = null;
      const value = parseFloat(sliderInput.value);
      if (Number.isFinite(value)) {
        void setSpeed(ctx, value);
      }
    });
    // Mobile: stop the page from scrolling while the user drags the slider
    // thumb. Mirrors .user.js:4824-4829 — without this, dragging on a
    // touch device scrolls the viewport instead of moving the thumb.
    // `passive: false` is required for preventDefault on touch events.
    ctx.cleanup.addEventListener(
      sliderInput,
      'touchmove',
      (e) => {
        e.preventDefault();
      },
      { passive: false },
    );
  }

  // ----- Menu-scoped cleanup registry. Disposed + replaced on every
  //       rerender so attachSettingsHandlers' ~25 listeners-per-render
  //       don't accumulate on the panel's main registry forever (would
  //       leak DOM-node refs to detached settings-menu children).
  let menuRegistry: CleanupRegistry | null = null;
  ctx.cleanup.add(() => {
    if (menuRegistry) {
      try {
        menuRegistry.dispose();
      } catch {
        /* swallow */
      }
      menuRegistry = null;
    }
  });

  // ----- Gear toggle -----
  //
  // After making the menu visible we measure its bounding box and flip
  // its anchor to the LEFT if the default right-anchored position
  // pushes it off the viewport (audit: user reported the menu vanishing
  // off the screen on narrow layouts where the gear sits near the
  // viewport's left edge -- happens in `bottom` layout when the panel
  // wraps and the gear lands on the second row).
  function isMenuOpen(): boolean {
    return settingsMenu.classList.contains('show');
  }

  // Vertical flip decision is FROZEN at menu-open time. Without this,
  // every tab switch (rerender) recomputed flip-y based on the current
  // tab's content height — and tabs of different heights would put the
  // menu above-gear on one tab and below-gear on the next. User
  // perceived this as the menu jumping around (audit 2026-04-28). The
  // first call to adjustMenuPosition after open decides; later calls
  // (tab switches, settings change) only refresh horizontal placement
  // and max-height. Reset to null when the menu closes.
  let frozenFlipY: 'up' | 'down' | null = null;

  function adjustMenuPosition(): void {
    if (!isMenuOpen()) return;

    // Audit 2026-05-10 root-cause: clear inline overrides BEFORE
    // measuring. settingsMenu.scrollHeight reflects the current
    // (clamped) layout, so reading it without first clearing
    // max-height would return the previous-call's clamp value, not
    // the natural content height. That made `naturalH > room`
    // misfire and the menu would alternate between clamped and
    // unclamped on each call — visually it lost its top portion
    // (header + tabs scrolled past the viewport top) and then
    // "self-recovered" on the next pass.
    settingsMenu.removeAttribute('data-vs-flip');
    settingsMenu.removeAttribute('data-vs-flip-y');
    settingsMenu.style.removeProperty('max-height');
    settingsMenu.style.removeProperty('left');
    settingsMenu.style.removeProperty('right');

    const PAD = 8;
    const wrapperRect = gearWrapper.getBoundingClientRect();
    const gearRect = gearBtn.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const menuRect = settingsMenu.getBoundingClientRect();
    const menuW = settingsMenu.offsetWidth || menuRect.width;
    const naturalH = settingsMenu.scrollHeight;
    const spaceBelow = Math.max(0, viewportH - gearRect.bottom - PAD);
    const spaceAbove = Math.max(0, gearRect.top - PAD);

    let absLeft = wrapperRect.right - menuW;
    if (absLeft < PAD) {
      const leftAnchored = wrapperRect.left;
      if (leftAnchored + menuW <= viewportW - PAD) {
        absLeft = leftAnchored;
      } else {
        absLeft = Math.max(PAD, viewportW - menuW - PAD);
      }
    }
    if (frozenFlipY === null) {
      if (menuRect.bottom > viewportH - 4 && spaceAbove > spaceBelow) {
        frozenFlipY = 'up';
      } else {
        frozenFlipY = 'down';
      }
    }
    const room = frozenFlipY === 'up' ? spaceAbove : spaceBelow;
    const needsMaxHeight = naturalH > room && room > 0;

    settingsMenu.style.left = `${absLeft - wrapperRect.left}px`;
    settingsMenu.style.right = 'auto';
    if (frozenFlipY === 'up') {
      settingsMenu.setAttribute('data-vs-flip-y', 'up');
    }
    if (needsMaxHeight) {
      settingsMenu.style.maxHeight = `${room}px`;
    }
  }

  function closeMenu(): void {
    settingsMenu.classList.remove('show');
    settingsMenu.setAttribute('aria-hidden', 'true');
    gearBtn.setAttribute('aria-expanded', 'false');
    // Reset the frozen flip so the next open re-decides based on the
    // current viewport (the user may have scrolled or resized).
    frozenFlipY = null;
  }

  ctx.cleanup.addEventListener(gearBtn, 'click', (event) => {
    event.stopPropagation();
    if (isMenuOpen()) {
      closeMenu();
    } else {
      rerenderSettings();
      settingsMenu.classList.add('show');
      settingsMenu.setAttribute('aria-hidden', 'false');
      gearBtn.setAttribute('aria-expanded', 'true');
      adjustMenuPosition();
    }
  });

  // Stop clicks INSIDE the menu from bubbling to YouTube's body-level
  // click delegation (Polymer/React event delegate would otherwise
  // re-interpret tab/toggle clicks as host-page actions). Ported from
  // .user.js:4758. Also keeps the document-close handler below from
  // firing on intra-menu clicks.
  ctx.cleanup.addEventListener(settingsMenu, 'click', (event) => {
    event.stopPropagation();
  });

  // Audit 2026-05-09 MAJOR-UI: Escape closes the menu (a11y / standard
  // dialog convention).
  ctx.cleanup.addEventListener(
    document,
    'keydown',
    (event) => {
      if (!isMenuOpen()) return;
      const ev = event as KeyboardEvent;
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        ev.preventDefault();
        closeMenu();
        gearBtn.focus();
      }
    },
    { capture: true },
  );

  // Click outside the gear-wrapper closes the menu.
  ctx.cleanup.addEventListener(document, 'click', (event) => {
    if (!isMenuOpen()) return;
    const target = event.target as Node | null;
    if (target && !gearWrapper.contains(target)) {
      closeMenu();
    }
  });

  // ----- Settings re-renderer -----
  function rerenderSettings(): void {
    // Dispose the previous menu's listeners first. Bounds the listener
    // count to the current render's needs.
    if (menuRegistry) menuRegistry.dispose();
    menuRegistry = new CleanupRegistry();
    const menuCtx: AppContext = { ...ctx, cleanup: menuRegistry };


    settingsMenu.replaceChildren(
      renderSettingsMenu({
        settings: ctx.settingsStore.get(),
        site: ctx.site,
        i18n: ctx.i18n,
        activeTab,
        scriptVersion,
        // Read each flag from its OWN getter. The previous code used
        // killSwitchEngaged() (= !healthCheckEnabled) for the discovery
        // toggle, so the discovery checkbox always mirrored the
        // healthcheck state -- regression M8.
        discoveryEnabled: killSwitch ? killSwitch.isDiscoveryEnabled() : true,
        healthCheckEnabled: killSwitch ? killSwitch.isHealthCheckEnabled() : true,
      }),
    );

    attachSettingsHandlers(settingsMenu, menuCtx, {
      setActiveTab: (t) => {
        activeTab = t;
      },
      rerender: rerenderSettings,
      onDiag: (action) => {
        ctx.logger.info('diagnostics action', action);
        if (action === 'recheck') {
          if (diagActions) {
            diagActions.recheck();
          }
          refreshDiagnosticStatus(settingsMenu, menuCtx);
          // Toast the result so the user gets feedback. Mirrors
          // .user.js:4585-4588.
          const ok = ctx.diagnostics.isHealthy();
          ctx.ui.showNotification(
            ctx.i18n.t(ok ? 'toast.diag_ok' : 'toast.diag_issues'),
            ok ? 'success' : 'warn',
          );
        } else if (action === 'copy') {
          if (diagActions) {
            void diagActions.copyReport().then((copied) => {
              ctx.ui.showNotification(
                ctx.i18n.t(copied ? 'toast.report_copied' : 'toast.report_copy_failed'),
                copied ? 'success' : 'error',
              );
            });
          }
        } else if (action === 'purge-cache') {
          if (diagActions) {
            void diagActions.purgeCache().then(() => {
              ctx.ui.showNotification(ctx.i18n.t('toast.cache_cleared'), 'info');
              refreshDiagnosticStatus(settingsMenu, menuCtx);
            });
          }
        } else if (action === 'full-reset') {
          if (diagActions) {
            void diagActions.fullReset().then(() => {
              ctx.ui.showNotification(ctx.i18n.t('toast.reset_done'), 'info');
            });
          }
        }
      },
      // Wire the KillSwitch toggles only when a real KillSwitch was
      // injected (the popup uses no-op stubs since it can't trip a
      // foreign content script's discovery anyway).
      setDiscoveryEnabled: killSwitch
        ? (on) => {
            void killSwitch.setDiscoveryEnabled(on);
          }
        : undefined,
      setHealthCheckEnabled: killSwitch
        ? (on) => {
            void killSwitch.setHealthCheckEnabled(on);
          }
        : undefined,
    });

    refreshDiagnosticStatus(settingsMenu, menuCtx);
    // Re-evaluate flip after the rerender -- modal width can change
    // when the active tab is swapped (Diagnostics tab is wider than
    // General). Cheap, runs only when the menu is open.
    adjustMenuPosition();
  }

  // Layout applier. Mirrors .user.js:4854-4894 (`applyLayout`) -- see the
  // `applyLayout` member below for the full rationale; that member just
  // delegates here.
  function applyLayoutImpl(): void {
    const pos = ctx.settingsStore.getKey('sliderPosition');
    root.dataset.vsSliderPosition = pos;

    const chrome =
      ctx.discovery.resolve('rightControls') || ctx.discovery.resolve('controlsContainer');

    ctx.logger.info(
      `panel.applyLayout: pos=${pos} chrome=${chrome ? chrome.className : 'null'} sliderParent=${sliderContainer.parentElement?.className ?? '(orphan)'}`,
    );

    if (pos === 'video' && chrome) {
      sliderContainer.classList.add('vs-slider-in-chrome');
      if (sliderContainer.parentElement !== chrome || sliderContainer !== chrome.firstChild) {
        try {
          chrome.insertBefore(sliderContainer, chrome.firstChild);
          ctx.logger.info('panel.applyLayout: slider moved into chrome');
        } catch (e) {
          ctx.logger.warn('panel.applyLayout: chrome insert failed', e);
        }
      }
    } else {
      sliderContainer.classList.remove('vs-slider-in-chrome');
      if (sliderContainer.parentElement !== root || sliderContainer.nextSibling !== gearWrapper) {
        try {
          root.insertBefore(sliderContainer, gearWrapper);
          ctx.logger.info('panel.applyLayout: slider restored into panel');
        } catch (e) {
          ctx.logger.warn('panel.applyLayout: root insert failed', e);
        }
      }
    }
  }

  // Re-render whenever settings change (language switch, etc.) AND
  // re-apply layout if sliderPosition changed. The settings-menu handlers
  // already invoke ctx.ui.applyLayout() directly on radio click, but the
  // popup (and any future settings-source) updates the store without
  // touching the UiPort -- this subscriber covers that path. Comparing
  // against `lastPos` avoids re-running applyLayout on every unrelated
  // setting toggle (rememberSpeed, language, hotkeys, ...).
  let lastPos = ctx.settingsStore.getKey('sliderPosition');
  let lastPresetsKey = JSON.stringify(ctx.settingsStore.getKey('speedPresets') ?? []);
  let lastRange = initialRange;
  const offSubscribe = ctx.settingsStore.subscribe((next) => {
    if (next.sliderPosition !== lastPos) {
      lastPos = next.sliderPosition;
      applyLayoutImpl();
      // Audit 2026-05-10: layout switch can move the gear button — reset
      // so adjustMenuPosition picks fresh flip from the new geometry.
      frozenFlipY = null;
    }
    // Speed-buttons row is reactive on speedPresets — when the user
    // toggles a speed in Settings → General we need to rebuild the row's
    // contents in place. Click handlers live on the outer `buttonsRow`
    // via event delegation, so swapping its CHILDREN doesn't lose the
    // handlers (audit M12).
    const nextPresetsKey = JSON.stringify(next.speedPresets ?? []);
    if (nextPresetsKey !== lastPresetsKey) {
      lastPresetsKey = nextPresetsKey;
      const fresh = renderButtonsRow({
        speeds: resolvePresets(),
        current: ctx.speedStore.current(),
        pinned: computePinnedSpeed(),
        buttonTitle: ctx.i18n.t('panel.button.tooltip'),
      });
      buttonsRow.replaceChildren(...Array.from(fresh.childNodes));
    }
    // Slider range reactive on sliderMin/sliderMax — re-resolve and
    // patch the live <input> in-place. Cheap (no rebuild) and preserves
    // the input's bound listeners. Same `resolveSliderRange` as the
    // initial render so fallback to site defaults stays consistent.
    const nextRange = resolveSliderRange();
    if (nextRange.min !== lastRange.min || nextRange.max !== lastRange.max) {
      lastRange = nextRange;
      setSliderRange(sliderContainer, nextRange.min, nextRange.max);
    }
    // Pinned dot is gated on rememberSpeed; refresh whenever the
    // settings change so the user sees the toggle take effect live.
    refreshPinnedButton(buttonsRow, computePinnedSpeed());
    if (isMenuOpen()) {
      rerenderSettings();
    }
  });
  ctx.cleanup.add(offSubscribe);

  return {
    element: root,
    refreshButtons(speed) {
      refreshActiveButton(buttonsRow, speed);
      // Pin tracks the saved/default speed; refresh it on every speed
      // change so a fresh setGlobal() (double-click) lights up the
      // matching pill within the same frame.
      refreshPinnedButton(buttonsRow, computePinnedSpeed());
    },
    refreshSlider(speed) {
      setSliderValue(sliderContainer, speed);
    },
    /** Public API: rerender the modal IF it's currently visible. Called
     *  by the health-checker subscriber in index.ts on every report; we
     *  no-op when the menu is hidden so the modal's rerender chain does
     *  not run continuously in the background. */
    rerenderSettings: () => {
      if (isMenuOpen()) {
        rerenderSettings();
      }
    },
    applyLayout: applyLayoutImpl,
    setGearWarning(on) {
      gearBtn.classList.toggle('has-warning', on);
    },
    dispose() {
      // Audit 2026-05-09 sec C16: also remove orphan notification stack
      // and speed popup that live OUTSIDE root.
      try {
        disposeNotificationStack();
      } catch {
        /* swallow */
      }
      try {
        disposeSpeedPopup();
      } catch {
        /* swallow */
      }
      root.remove();
      sliderContainer.remove();
    },
  };
}
