import type { Translator } from '../app/ports';
import { type DictKey, I18N_DICT, type Lang } from './dict';

/**
 * HTML escaper. Use at the point of insertion into a backtick template,
 * NOT inside `t()` itself. Translations are plain text by contract
 * (audit M3); escaping happens only when we hand a string to innerHTML
 * or to an attribute.
 */
export function escHtml(s: unknown): string {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return c;
    }
  });
}

/**
 * Build a Translator bound to a specific language.
 *
 * Lookup chain: requested lang -> English (canonical) -> the key itself.
 * The last fallback exists so a missing key surfaces visibly in the UI
 * instead of disappearing.
 *
 * `vars` substitutes `{name}` placeholders. Values are coerced to string;
 * caller is responsible for escaping HTML in user-supplied values BEFORE
 * passing them in (since the result of `t()` may end up inside a backtick
 * template that already runs through escHtml at the outer scope).
 */
export function createTranslator(lang: Lang): Translator {
  const dict = I18N_DICT[lang] as Readonly<Record<string, string>>;
  const fallback = I18N_DICT.en as Readonly<Record<string, string>>;

  const t = (key: string, vars?: Record<string, string | number>): string => {
    let s: string | undefined = dict[key];
    if (s == null) s = fallback[key];
    if (s == null) return key;
    if (vars) {
      // Audit 2026-05-09 perf P4: split().join() instead of new RegExp().
      // All placeholder names in the dict are plain ASCII identifiers
      // (e.g. {count}, {time}, {speed}), so regex escaping is unnecessary.
      // Allocates one intermediate array per substitution but skips the
      // RegExp constructor + compile that fired on every t() call with
      // vars (~10 RegExp compilations per modal rerender, multiplied by
      // every render path that touches translated strings with placeholders).
      for (const k of Object.keys(vars)) {
        const value = vars[k];
        if (value == null) continue;
        const placeholder = `{${k}}`;
        if (s.includes(placeholder)) {
          s = s.split(placeholder).join(String(value));
        }
      }
    }
    return s;
  };

  return { t, escHtml };
}

/**
 * Treat `t()` as a typed alias when the key is statically known. Useful in
 * code that imports specific keys -- compile fails on a typo.
 */
export type TypedT = (key: DictKey, vars?: Record<string, string | number>) => string;
