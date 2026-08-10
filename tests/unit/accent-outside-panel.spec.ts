/**
 * The site accent has to reach surfaces that live OUTSIDE the panel.
 *
 * Reported 2026-08-10 with a screenshot: on HDRezka the speed buttons were the
 * site's blue, but the in-player slider next to them was YouTube red. The
 * accent is declared on `.vs-panel[data-vs-site]`, and sliderPosition='video'
 * deliberately moves the slider OUT of the panel into the player's own control
 * bar — where the rule no longer matches and `:root` wins.
 *
 * The fix tags <html> with the site (src/index.ts), so every detached surface
 * inherits. This pins both halves: the stylesheet must carry an html-scoped
 * accent rule, and an element outside the panel must actually resolve to it.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { injectStyles, removeStyles } from '../../src/ui/styles';

afterEach(() => {
  removeStyles(document);
  delete document.documentElement.dataset.vsSite;
  document.body.replaceChildren();
});

describe('site accent outside the panel', () => {
  it('is declared for <html>, not only for .vs-panel', () => {
    injectStyles('hdrezka', document);
    const css = (document.getElementById('vs-styles')?.textContent ?? '').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    const accentRule = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(
      ([, sel, body]) => sel.includes('data-vs-site') && body.includes('--vs-accent:'),
    );
    expect(accentRule, 'no per-site accent rule at all').toBeDefined();
    const selector = accentRule?.[1] ?? '';
    expect(selector, 'accent is panel-scoped only — a detached surface cannot reach it').toContain(
      'html[data-vs-site',
    );
  });

  it('gives the html-scoped rule the site colour, not the :root fallback', () => {
    // Asserted on the rule text rather than on getComputedStyle: happy-dom does
    // not cascade custom properties, so a computed-value check here passes or
    // fails on the test environment instead of on the stylesheet. The rule text
    // is what actually decides the colour in a browser, and it is what was
    // wrong. The visual proof is the owner's screenshot from the report.
    injectStyles('hdrezka', document);
    const css = (document.getElementById('vs-styles')?.textContent ?? '').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    const htmlRule = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(
      ([, sel, body]) => sel.includes('html[data-vs-site') && body.includes('--vs-accent:'),
    );
    expect(htmlRule, 'no html-scoped accent rule').toBeDefined();
    expect((htmlRule?.[2] ?? '').toLowerCase()).toContain('#00a1db');
    // And the red must NOT be what this site declares.
    expect((htmlRule?.[2] ?? '').toLowerCase()).not.toContain('#ff0000');
  });
});
