/**
 * Normalize legacy hotkey shapes coming out of page-localStorage.
 *
 * Old userscript versions (pre-1.0) stored a single `Hotkey` object instead
 * of an array. Newer versions store `Hotkey[]`. Some installs end up with an
 * empty array (after a buggy edit). We normalise all three to "non-empty
 * `Hotkey[]`, falling back to the defaults" so downstream code only ever
 * sees one shape.
 */

import type { Hotkey } from './types';

/**
 * Treat any non-Hotkey-shaped input as missing. The match is structural:
 * we accept anything with a string `key` and 4 booleans, ignoring extras.
 *
 * Empty `key` strings are accepted — they represent a placeholder slot
 * the user just added but hasn't filled in yet. matchesSingleHotkey
 * has a defensive guard that refuses to match empty keys (Chrome
 * dispatches keydown with empty `event.code` for media keys / dead-keys
 * / IME composition, which would otherwise trigger speedUp every time
 * the user pressed Play/Pause on a keyboard or headset — user bug
 * 2026-04-28). So empty placeholders are inert by design here.
 */
function isHotkey(value: unknown): value is Hotkey {
  if (!value || typeof value !== 'object') return false;
  const h = value as Record<string, unknown>;
  return (
    typeof h.key === 'string' &&
    typeof h.ctrl === 'boolean' &&
    typeof h.shift === 'boolean' &&
    typeof h.alt === 'boolean' &&
    typeof h.meta === 'boolean'
  );
}

/**
 * Normalise an unknown raw value into a non-empty `Hotkey[]`.
 *
 * Order of precedence:
 *   - already a non-empty array of valid Hotkeys -> filter and return
 *   - a single Hotkey object (legacy)            -> wrap in array
 *   - empty array, missing, or malformed         -> return defaults
 */
export function normalizeHotkeys(raw: unknown, defaults: Hotkey[]): Hotkey[] {
  if (Array.isArray(raw)) {
    // Audit 2026-05-11 W1.4 (SEC-001): cap to MAX_HOTKEYS so a hostile
    // localStorage migration (page-controlled origin) cannot push a
    // 10k-element hotkeys array into storage — every panel rerender
    // would scale linearly with the count. 16 is well above any real
    // user's needs (typical: 1-2 combos per action).
    const valid = raw.filter(isHotkey).slice(0, 16);
    return valid.length > 0 ? valid : defaults;
  }
  if (isHotkey(raw)) {
    return [raw];
  }
  return defaults;
}
