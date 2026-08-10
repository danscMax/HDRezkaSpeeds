/**
 * The speed confirmation sits in the SAME place in a window and in fullscreen.
 *
 * It did not, and the mismatch was reported as a bug (2026-08-10): the plate
 * hung at the middle of the right edge in a window and jumped to top-centre in
 * fullscreen. Both anchors had a reason — right-edge imitates a native volume
 * indicator, top-centre is the only place a person actually sees on a 1920×1080
 * fullscreen — but a control that moves between modes reads as broken.
 *
 * Only the SCALE may differ. This guards the anchor, not the size.
 */

import { describe, expect, it } from 'vitest';
import { injectStyles, removeStyles } from '../../src/ui/styles';

/** Declarations of the first rule whose selector satisfies `match`. */
function declarationsOf(css: string, match: (selector: string) => boolean): string {
  // Comments first: they mention selectors and properties on purpose, and a
  // naive split would hand them back as if they were rules.
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, selector, body] of bare.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (match(selector.trim())) return body;
  }
  return '';
}

const valueOf = (body: string, prop: string): string | null =>
  body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`))?.[1]?.trim() ?? null;

describe('the speed popup keeps one anchor across modes', () => {
  const css = (() => {
    injectStyles('hdrezka', document);
    const text = document.getElementById('vs-styles')?.textContent ?? '';
    removeStyles(document);
    return text;
  })();

  const base = declarationsOf(
    css,
    (s) => s === '#speed-popup.speed-popup' || s === '#speed-popup.speed-popup ',
  );
  const fullscreen = declarationsOf(
    css,
    (s) => s.includes(':fullscreen') && s.includes('#speed-popup') && !s.includes('display'),
  );

  it('anchors to the top centre of the player by default', () => {
    expect(base, 'base popup rule not found').not.toBe('');
    expect(valueOf(base, 'left')).toBe('50%');
    expect(valueOf(base, 'right')).toBe('auto');
    expect(valueOf(base, 'transform')).toBe('translateX(-50%)');
  });

  it('does not move the popup when fullscreen takes over', () => {
    expect(fullscreen, 'fullscreen popup rule not found').not.toBe('');
    // The whole point: the fullscreen block may resize and restyle, but it must
    // not re-anchor. Any of these appearing here means the two modes have
    // drifted apart again.
    for (const prop of ['top', 'left', 'right', 'bottom', 'transform']) {
      expect(valueOf(fullscreen, prop), `fullscreen rule re-anchors via ${prop}`).toBeNull();
    }
  });

  it('still scales up in fullscreen', () => {
    // Guards the other direction: unifying the anchor must not have flattened
    // the size difference, which is what makes it readable across a room.
    expect(valueOf(fullscreen, 'font-size')).toBe('30px');
    expect(valueOf(base, 'font-size')).not.toBe('30px');
  });
});
