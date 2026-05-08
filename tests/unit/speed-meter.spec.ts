import { describe, expect, it } from 'vitest';
import { createRatechangeMeter } from '../../src/speed/meter';

describe('RatechangeMeter', () => {
  it('starts empty', () => {
    const m = createRatechangeMeter();
    expect(m.perMinute()).toBe(0);
    expect(m.tail()).toEqual([]);
  });

  it('tick records from/to coerced to numbers', () => {
    const m = createRatechangeMeter();
    m.tick(1, 1.5);
    m.tick('2', '2.5'); // string coercion
    m.tick(null, 3); // null -> null

    const t = m.tail();
    expect(t).toHaveLength(3);
    expect(t[0]).toMatchObject({ from: 1, to: 1.5 });
    expect(t[1]).toMatchObject({ from: 2, to: 2.5 });
    expect(t[2]).toMatchObject({ from: null, to: 3 });
  });

  it('tick coerces NaN to null', () => {
    const m = createRatechangeMeter();
    m.tick(NaN, undefined);
    expect(m.tail()[0]).toMatchObject({ from: null, to: null });
  });

  it('drops events older than 60s', () => {
    let now = 0;
    const m = createRatechangeMeter(() => now);

    now = 0;
    m.tick(1, 1.5);
    now = 30_000;
    m.tick(1.5, 2);
    now = 70_000; // first tick is now > 60s old

    expect(m.perMinute()).toBe(1);

    // Add another tick at 70_000 -- old one should drop on next push.
    m.tick(2, 2.5);
    expect(m.tail().length).toBe(2); // 30_000 + 70_000
  });

  it('caps tail at MAX_TAIL=50 even within window', () => {
    let now = 0;
    const m = createRatechangeMeter(() => now);
    for (let i = 0; i < 60; i++) {
      now += 100;
      m.tick(i, i + 1);
    }
    expect(m.tail(100)).toHaveLength(50);
  });

  it('clear() resets', () => {
    const m = createRatechangeMeter();
    m.tick(1, 2);
    m.tick(2, 3);
    m.clear();
    expect(m.perMinute()).toBe(0);
    expect(m.tail()).toEqual([]);
  });

  it('tail(n) returns last n events as a copy', () => {
    const m = createRatechangeMeter();
    m.tick(1, 1.5);
    m.tick(1.5, 2);
    m.tick(2, 2.5);

    const t = m.tail(2);
    expect(t).toHaveLength(2);
    expect(t[0]?.from).toBe(1.5);

    // Mutating the snapshot should NOT affect internal state.
    t[0]!.from = 999;
    expect(m.tail(2)[0]?.from).toBe(1.5);
  });
});
