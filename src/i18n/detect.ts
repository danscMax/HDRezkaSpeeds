import { type Lang, SUPPORTED_LANGS } from './dict';

/**
 * Pick a UI language from the browser's preferences.
 *
 * Walks `navigator.languages[]` in order and returns the first match against
 * SUPPORTED_LANGS by primary subtag (so `ru-RU` -> `ru`, `en-GB` -> `en`).
 * Falls back to `en` for anything else, since English is the canonical
 * dictionary and guaranteed to have every key.
 *
 * Pure-ish: reads from navigator only, never mutates anything.
 */
export function detectBrowserLang(): Lang {
  try {
    const list: readonly string[] =
      typeof navigator !== 'undefined' &&
      Array.isArray(navigator.languages) &&
      navigator.languages.length > 0
        ? navigator.languages
        : [(typeof navigator !== 'undefined' && navigator.language) || 'en'];

    // Audit 2026-05-09 Q7: match against the BCP-47 primary subtag, not
    // a string prefix. `code.startsWith('en')` would match imaginary
    // tags like `eng-*` (or future `en` collisions), and once
    // SUPPORTED_LANGS contains both `zh` and `zh-Hant` the OR-prefix
    // would silently pick whichever sat first in the array.
    for (const raw of list) {
      const code = String(raw ?? '').toLowerCase();
      const primary = code.split(/[-_]/)[0] ?? code;
      for (const lang of SUPPORTED_LANGS) {
        if (primary === lang) return lang;
      }
    }
  } catch {
    // navigator may be missing in tests / SSR-like contexts
  }
  return 'en';
}
