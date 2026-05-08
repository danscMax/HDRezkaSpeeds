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

    for (const raw of list) {
      const code = String(raw ?? '').toLowerCase();
      for (const lang of SUPPORTED_LANGS) {
        if (code.startsWith(lang)) return lang;
      }
    }
  } catch {
    // navigator may be missing in tests / SSR-like contexts
  }
  return 'en';
}
