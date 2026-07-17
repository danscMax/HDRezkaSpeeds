import { describe, expect, it } from 'vitest';
import { classifyMirrorBody, MIN_LIVE_BYTES } from '../../src/sites/mirror-reach';

// Calibrated against real bytes measured from the user's network (2026-07):
//   - live mirrors (hdrezka.cm, standby-rezka.tv): HTTP 200, ~41 KB, self-ref "rezka"
//   - blocked/ISP mirrors (rezka.ag ...): HTTP 200, ~4.6 KB, "checking you're not a bot"
//   - dead mirrors: fetch rejects/times out -> caller returns 'dead' (not this fn)
describe('classifyMirrorBody', () => {
  const bigRezka = `${'x'.repeat(MIN_LIVE_BYTES)} rezka `;

  it('classifies a full HDRezka homepage (large + self-references rezka) as live', () => {
    expect(classifyMirrorBody(true, bigRezka)).toBe('live');
  });

  it('classifies a small anti-bot / stub 200 as challenge (still open-able in a tab)', () => {
    const stub = 'Проверяем, что вы не бот'.repeat(50); // ~1.1 KB, well under the floor
    expect(stub.length).toBeLessThan(MIN_LIVE_BYTES);
    expect(classifyMirrorBody(true, stub)).toBe('challenge');
  });

  it('classifies a large page that never says rezka as challenge (guards a big block page)', () => {
    expect(classifyMirrorBody(true, 'x'.repeat(MIN_LIVE_BYTES + 100))).toBe('challenge');
  });

  it('classifies a non-ok (>=400) response as dead regardless of body', () => {
    expect(classifyMirrorBody(false, bigRezka)).toBe('dead');
  });

  it('treats a body exactly at the size floor (with rezka) as live', () => {
    const exact = `rezka${'x'.repeat(MIN_LIVE_BYTES - 5)}`;
    expect(exact.length).toBe(MIN_LIVE_BYTES);
    expect(classifyMirrorBody(true, exact)).toBe('live');
  });
});
