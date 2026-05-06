/**
 * Runtime constants for the HDRezka Speed Controller extension.
 *
 * Per-site speed bounds and storage keys are derived once at bootstrap from
 * the detected `Site` so feature modules can stay site-agnostic.
 */

import type { Site } from './app/ports';

/**
 * Speed step used by Speed-Up / Slow-Down hotkeys.
 *
 * Source: hotkey handlers in the original userscript use literal `+0.1` /
 * `-0.1`, and the i18n labels (`hotkeys.speedup_label` etc.) reflect the
 * same value to the user. Keep these in sync if you ever change the step.
 */
export const SPEED_STEP = 0.1;

/**
 * Per-site speed bounds. HDRezka uses Plyr; the original userscript
 * defaulted HDRezka to 1.4x and capped the in-player buttons to 1.0–2.0
 * with a 0.1 step (fine-grained for movies). Upper bound raised to 10x to
 * accommodate the manual custom-speed input (Settings → General → "Speed
 * buttons").
 */
export interface SpeedBounds {
  readonly min: number;
  readonly max: number;
  readonly defaultSpeed: number;
}

const SPEED_BOUNDS: Record<Site, SpeedBounds> = {
  hdrezka: { min: 0.5, max: 10.0, defaultSpeed: 1.4 },
};

export function speedBoundsFor(site: Site): SpeedBounds {
  return SPEED_BOUNDS[site];
}

/**
 * The full pool of speeds the user can pick from in the Settings →
 * "Speed buttons" customisation grid. Filtered to the site's
 * `[min, max]` bounds at render time. Power users can still type any
 * 0.5x–10x value in the custom-input field (vs-preset-custom-input).
 *
 * HDRezka tuning: fine-grained 0.1 step in the 1.0–2.0 range (movie
 * playback is most useful in that band), then sparse coarse values
 * above 2.0 so the picker doesn't get overwhelming.
 */
export const SPEED_POOL: readonly number[] = [
  0.5, 0.75,
  1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2,
  2.5, 3, 4,
] as const;

/**
 * Default visible speed buttons per site. Used as the initial value of
 * `Settings.speedPresets` for fresh installs.
 *
 * Mirrors the original userscript: HDRezka renders 1.0–2.0 with a 0.1
 * step (detailed control for movie playback).
 */
const DEFAULT_PRESETS: Record<Site, readonly number[]> = {
  hdrezka: [1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2],
};

export function defaultPresetsFor(site: Site): readonly number[] {
  return DEFAULT_PRESETS[site];
}

/**
 * Storage keys per site. Match the legacy userscript keys verbatim so the
 * page-localStorage migration finds them on first run.
 */
export interface StorageKeys {
  readonly settings: string;
  readonly speed: string;
}

const STORAGE_KEYS: Record<Site, StorageKeys> = {
  hdrezka: {
    settings: 'hdrezka-speed-settings',
    speed:    'hdrezka-selected-speed',
  },
};

export function storageKeysFor(site: Site): StorageKeys {
  return STORAGE_KEYS[site];
}

/**
 * Cache key prefix used by SelectorCache for per-host entries.
 *
 * Shape: `vs-cache:<host>` -> { schema_version, script_version, entries, backups }
 * (single bag in `browser.storage.local`, hydrated once at bootstrap).
 */
export const SELECTOR_CACHE_PREFIX = 'vs-cache:';

/**
 * Marker stored in settings after the one-time TM page-localStorage
 * migration succeeds, so the import never re-runs and never clobbers
 * subsequent extension-side edits.
 */
export const TM_MIGRATION_FLAG = '__migrated_from_tm';

/**
 * Feedback Worker endpoint. The Worker source lives in
 * `cloudflare-worker/`; the URL is whatever the deploy step printed
 * (e.g. `https://speeds-feedback.<account>.workers.dev`).
 *
 * Replace the placeholder before shipping a build that wires the
 * feedback form to the live Worker. Until then the form falls back
 * to the mailto: link displayed below the submit button.
 */
export const FEEDBACK_WORKER_URL =
  'https://speeds-feedback.matsiyak.workers.dev/feedback';

/**
 * Plain-text contact, shown as a fallback when the Worker call fails
 * (and prefilled into the in-extension feedback page footer).
 */
export const FALLBACK_CONTACT_EMAIL = 'matsiyak@gmail.com';

/**
 * App identifier sent to the Worker so it can route / label messages
 * coming from this extension. Mirror of the value declared in
 * `cloudflare-worker/wrangler.toml` ALLOWED_APPS.
 */
export const FEEDBACK_APP_ID = 'hdrezka';
