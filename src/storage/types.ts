/**
 * Concrete data types backing SettingsStore / SpeedStore.
 *
 * Lives in storage/ rather than app/ports.ts because the port interface owns
 * the contract while this module owns the shape. Anything that wants to
 * inspect a Settings field still goes through `ctx.settingsStore.get()` —
 * never imports this file directly outside storage/, migration, and tests.
 */

import type { Site } from '../app/ports';
import { defaultPresetsFor } from '../config';
import type { Lang } from '../i18n/dict';

/**
 * One key-combo entry. Matches the legacy userscript shape verbatim
 * so page-localStorage migration is a no-op deserialise.
 */
export interface Hotkey {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  /** KeyboardEvent.code, e.g. "KeyC", "Insert", "ArrowUp". */
  key: string;
}

/** Where the speed slider is rendered relative to the speed buttons. */
export type SliderPosition = 'right' | 'bottom' | 'video';

/**
 * The full settings object persisted under `<site>-speed-settings`. A user
 * who installed the extension without the userscript starts from
 * `defaultSettings(lang)`.
 */
export interface Settings {
  sliderPosition: SliderPosition;
  rememberSpeed: boolean;
  language: Lang;
  hotkeys: {
    speedUp: Hotkey[];
    speedDown: Hotkey[];
    /** FEAT-011: jump straight back to 1.0×. Optional — absent in
     *  pre-0.5 stored settings; normalised to [] on load. */
    resetSpeed?: Hotkey[];
    /** FEAT-012: swap between the current speed and the one that was
     *  active when the toggle was last pressed (VLC/mpv idiom). */
    toggleLast?: Hotkey[];
    /** FEAT-014: seek by ±seekSeconds. Unbound by default — Alt+←/→
     *  belong to browser history, so the user picks their own combo. */
    seekForward?: Hotkey[];
    seekBack?: Hotkey[];
  };
  /**
   * The visible set of speed-preset buttons in the in-player panel.
   * User can toggle individual values via Settings → General → "Speed
   * buttons". Picked from `SPEED_POOL` filtered to the site's
   * [min, max] bounds. Empty array is treated as "use site defaults"
   * to keep the panel useful even after an accidental clear-all.
   */
  speedPresets: number[];
  /**
   * Hotkey step in playback rate units. Speed-Up adds this, Slow-Down
   * subtracts. Default 0.1 mirrors the userscript baseline. Configurable
   * from welcome page and (eventually) Settings → Keys. Range 0.01..1.0.
   */
  speedStep: number;
  /**
   * User-configured slider lower bound. Undefined means "use the site
   * default" (speedBoundsFor(site).min). Validated to fall within
   * (0, sliderMax) and within the site's hard min/max range.
   */
  sliderMin?: number;
  /**
   * User-configured slider upper bound. Undefined means "use the site
   * default" (speedBoundsFor(site).max). Validated to fall within
   * (sliderMin, site.max].
   */
  sliderMax?: number;
  /**
   * UX-031: compact panel mode. When on, the panel collapses to just
   * the current-speed button + gear (presets, slider and pin hidden via
   * CSS) so the row stops competing with the page for attention.
   */
  compactMode?: boolean;
  /**
   * FEAT-015: remember the chosen speed per content item — per HDRezka
   * title (covers all episodes of a show) / per YouTube channel. Opt-in:
   * pickInitialSpeed consults the memory map only when this is true.
   */
  rememberPerVideo?: boolean;
  /**
   * FEAT-013: keep audio pitch constant while changing speed. Mirrors
   * HTMLMediaElement.preservesPitch, which browsers default to true —
   * so `undefined` means "preserve" and only an explicit false lets
   * the pitch shift naturally ("vinyl mode").
   */
  preservePitch?: boolean;
  /**
   * FEAT-014: seconds jumped by the seekForward / seekBack hotkeys.
   * Range 1–120, default 10.
   */
  seekSeconds?: number;
  /**
   * FEAT-017: Web Audio gain multiplier, 1.0 (off) .. 3.0. Stays 1.0
   * unless the user opts in — building the audio graph is irreversible
   * per element and silences cross-origin media without CORS headers.
   */
  volumeBoost?: number;
  /**
   * Last theme detected on the host page. Written by the content script's
   * theme watcher; read by the toolbar popup so it can match the host
   * page's theme instead of guessing from OS prefers-color-scheme.
   */
  lastSeenTheme?: 'dark' | 'light';
  /** Set after a successful one-time TM-import on first run. */
  __migrated_from_tm?: boolean;
  /**
   * Defense-in-depth toggles persisted on user action from the Settings →
   * Diagnostics tab. KillSwitch state mirror — when a user toggles
   * `discoveryEnabled` or `healthCheckEnabled` off, the value must survive
   * a page reload (audit 2026-05-11 W1.3 SEC2-001: previously this patch
   * was dropped by sanitizePatch's whitelist, so toggles never reached
   * disk and re-enabled themselves on every bootstrap).
   */
  healing?: {
    discoveryEnabled?: boolean;
    healthCheckEnabled?: boolean;
  };
}

/**
 * Built fresh per init from the detected language. Hotkeys mirror the
 * userscript defaults (Ctrl+C / Ctrl+V) so existing users feel no change.
 *
 * Second slot per action: Ctrl+Insert / Shift+Insert.
 */
export function defaultSettings(language: Lang, site?: Site): Settings {
  return {
    sliderPosition: 'right',
    rememberSpeed: true,
    language,
    hotkeys: {
      // v0.3.5: Alt+Period / Alt+Comma (a.k.a. Alt+. / Alt+,). One
      // modifier instead of two, matches the >/< speed convention from
      // VLC / mpv, doesn't conflict with YouTube's native > / < (which
      // requires Shift), and avoids the Alt+Shift collision with the
      // Windows Ru/En layout switcher that the previous Alt+Shift+Arrow
      // default had. Existing users keep their stored hotkeys via
      // mergeAndValidate; only fresh installs and Full-Reset users see
      // the new default. Insert keys kept as a secondary slot for HTPC
      // remotes (uncommon, harmless).
      speedUp: [
        { ctrl: false, shift: false, alt: true, meta: false, key: 'Period' },
        { ctrl: true, shift: false, alt: false, meta: false, key: 'Insert' },
      ],
      speedDown: [
        { ctrl: false, shift: false, alt: true, meta: false, key: 'Comma' },
        { ctrl: false, shift: true, alt: false, meta: false, key: 'Insert' },
      ],
      // FEAT-011: Alt+0 — one keypress back to normal speed. Safe combo
      // (browsers use Ctrl+0 for zoom-reset, not Alt+0).
      resetSpeed: [{ ctrl: false, shift: false, alt: true, meta: false, key: 'Digit0' }],
      // FEAT-012/014: unbound by default — power features the user opts
      // into from Settings → Shortcuts.
      toggleLast: [],
      seekForward: [],
      seekBack: [],
    },
    speedPresets: site ? [...defaultPresetsFor(site)] : [1, 1.5, 2],
    speedStep: 0.1,
    compactMode: false,
    rememberPerVideo: false,
    preservePitch: true,
    seekSeconds: 10,
    volumeBoost: 1,
  };
}
