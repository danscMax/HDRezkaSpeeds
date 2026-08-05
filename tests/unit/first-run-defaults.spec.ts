/**
 * What a brand-new profile gets. Nothing pinned these before, and the value
 * that decides how the very first film plays sat unguarded: it was 1.4, so a
 * newcomer's first video started 40% faster with nothing on screen saying why
 * — indistinguishable from "the extension broke the player".
 */

import { describe, expect, it } from 'vitest';
import { defaultPresetsFor, speedBoundsFor } from '../../src/config';

describe('a fresh profile plays at normal speed', () => {
  it('starts at 1.0 on hdrezka', () => {
    expect(speedBoundsFor('hdrezka').defaultSpeed).toBe(1);
  });

  it('keeps the faster speeds one click away as presets', () => {
    // The point of the default change is "do not surprise", not "hide the
    // feature": the speed that used to be forced on first run must still be
    // sitting on the panel.
    expect(defaultPresetsFor('hdrezka')).toContain(1.4);
  });

  it('never defaults outside its own bounds', () => {
    const b = speedBoundsFor('hdrezka');
    expect(b.defaultSpeed).toBeGreaterThanOrEqual(b.min);
    expect(b.defaultSpeed).toBeLessThanOrEqual(b.max);
  });
});
