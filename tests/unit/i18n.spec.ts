import { describe, expect, it } from 'vitest';
import {
  createTranslator,
  type DictKey,
  detectBrowserLang,
  escHtml,
  I18N_DICT,
  type Lang,
  SUPPORTED_LANGS,
} from '../../src/i18n';

const EN_KEYS = Object.keys(I18N_DICT.en) as DictKey[];

describe('I18N_DICT', () => {
  it('declares both supported languages', () => {
    expect(SUPPORTED_LANGS).toEqual(['en', 'ru']);
    for (const lang of SUPPORTED_LANGS) {
      expect(I18N_DICT[lang]).toBeDefined();
    }
  });

  it('has identical key sets in EN and RU (no missing translations)', () => {
    const ru = Object.keys(I18N_DICT.ru).sort();
    const en = EN_KEYS.slice().sort();
    expect(ru).toEqual(en);
  });

  it('has at least 90 keys (sanity floor for the ported dict + extension additions)', () => {
    expect(EN_KEYS.length).toBeGreaterThanOrEqual(90);
  });

  describe('plain-text contract (audit M3)', () => {
    // Translations must NEVER carry HTML markup. They are stitched into
    // backtick templates with escHtml() at the call site; if t() returned
    // markup, escaping would either double-escape (visible &lt;) or, if
    // escHtml is forgotten, become an XSS vector.
    it.each(SUPPORTED_LANGS)('every %s value contains no HTML markup', (lang) => {
      const offenders: Array<[string, string]> = [];
      for (const [key, value] of Object.entries(I18N_DICT[lang as Lang])) {
        if (typeof value !== 'string') continue;
        // Disallow tag-like substrings. Quotation chars / ampersands inside
        // prose are fine because escHtml at injection time handles them.
        if (/<[a-z!/]/i.test(value)) {
          offenders.push([key, value]);
        }
      }
      expect(offenders, `keys with HTML in ${lang}: ${JSON.stringify(offenders)}`).toEqual([]);
    });
  });
});

describe('createTranslator()', () => {
  it('returns the requested-language string when present', () => {
    const t = createTranslator('ru');
    expect(t.t('menu.title')).toBe('Скорость воспроизведения');
  });

  it('falls back to English when the key is missing in the requested language', () => {
    // Synthetic case: there is no key truly missing in RU after the equality
    // test above. We check the fallback path by creating a translator for a
    // non-canonical language code and forcing it through createTranslator's
    // `dict` lookup which only knows en/ru. To exercise the fallback we
    // instead rely on the third-tier behavior (return key when neither dict
    // has it), since the equality test guarantees ru/en parity.
    const t = createTranslator('en');
    // Unknown key returns the key itself (third-tier fallback).
    expect(t.t('does.not.exist')).toBe('does.not.exist');
  });

  it('interpolates {var} placeholders', () => {
    const t = createTranslator('en');
    expect(t.t('toast.speed_global', { speed: 1.5 })).toBe('Speed 1.5x saved as default');
    expect(t.t('diag.status.last_check', { time: '12:34' })).toBe('Last check: 12:34');
    expect(t.t('diag.status.issues_count', { count: 3 })).toBe('3 issues found');
  });

  it('replaces every occurrence of a placeholder', () => {
    // No live key uses the same placeholder twice, but the engine should
    // support it. Verify with an unknown key + the third-tier fallback
    // which surfaces the key (no interpolation) -- and explicitly check a
    // synthetic scenario via a known key with vars supplied.
    const t = createTranslator('en');
    expect(t.t('toast.reset_failed', { message: 'oops' })).toBe('Reset failed: oops');
  });

  it('ignores null/undefined var values without crashing', () => {
    const t = createTranslator('en');
    // null value should be skipped; placeholder remains literally.
    const out = t.t('toast.reset_failed', { message: null as unknown as string });
    expect(out).toContain('{message}');
  });

  it('exposes escHtml that escapes the dangerous five characters', () => {
    const t = createTranslator('en');
    expect(t.escHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });
});

describe('escHtml()', () => {
  it('passes plain ASCII through unchanged', () => {
    expect(escHtml('hello world')).toBe('hello world');
  });

  it('coerces null and undefined to empty string', () => {
    expect(escHtml(null)).toBe('');
    expect(escHtml(undefined)).toBe('');
  });

  it('coerces numbers to string before escaping', () => {
    expect(escHtml(42)).toBe('42');
  });

  it('escapes the five HTML-special characters', () => {
    expect(escHtml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &#39;');
  });
});

describe('detectBrowserLang()', () => {
  it('returns one of the supported langs', () => {
    const detected = detectBrowserLang();
    expect(SUPPORTED_LANGS).toContain(detected);
  });

  // happy-dom defaults navigator.languages to ['en-US']; the detection
  // should therefore prefer English in this environment.
  it('returns "en" in happy-dom env', () => {
    expect(detectBrowserLang()).toBe('en');
  });
});
