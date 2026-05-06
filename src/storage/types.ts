/**
 * Concrete data types backing SettingsStore / SpeedStore.
 *
 * Lives in storage/ rather than app/ports.ts because the port interface owns
 * the contract while this module owns the shape. Anything that wants to
 * inspect a Settings field still goes through `ctx.settingsStore.get()` —
 * never imports this file directly outside storage/, migration, and tests.
 */

import { defaultPresetsFor } from '../config';
import type { Site } from '../app/ports';
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
   * Last theme detected on the host page. Written by the content script's
   * theme watcher; read by the toolbar popup so it can match the host
   * page's theme instead of guessing from OS prefers-color-scheme.
   */
  lastSeenTheme?: 'dark' | 'light';
  /** Set after a successful one-time TM-import on first run. */
  __migrated_from_tm?: boolean;
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
      speedUp: [
        { ctrl: true, shift: false, alt: false, meta: false, key: 'KeyC' },
        { ctrl: true, shift: false, alt: false, meta: false, key: 'Insert' },
      ],
      speedDown: [
        { ctrl: true, shift: false, alt: false, meta: false, key: 'KeyV' },
        { ctrl: false, shift: true, alt: false, meta: false, key: 'Insert' },
      ],
    },
    speedPresets: site ? [...defaultPresetsFor(site)] : [1, 1.5, 2],
    speedStep: 0.1,
  };
}
