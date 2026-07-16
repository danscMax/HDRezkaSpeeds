import { describe, expect, it } from 'vitest';
import { createMemoryStorageAdapter } from '../../src/storage/adapter';
import {
  clearPosition,
  formatClock,
  isResumeworthy,
  readPosition,
  writePosition,
} from '../../src/storage/last-position-store';

describe('isResumeworthy()', () => {
  it('rejects the first 30s (intro/recap)', () => {
    expect(isResumeworthy(0, 3000)).toBe(false);
    expect(isResumeworthy(29.9, 3000)).toBe(false);
    expect(isResumeworthy(30, 3000)).toBe(true);
  });

  it('rejects within 90s of the end (effectively finished)', () => {
    expect(isResumeworthy(2950, 3000)).toBe(false); // 2950 > 3000-90
    expect(isResumeworthy(2000, 3000)).toBe(true);
  });

  it('applies only the lower bound when duration is unknown', () => {
    expect(isResumeworthy(500, Number.POSITIVE_INFINITY)).toBe(true);
    expect(isResumeworthy(500, Number.NaN)).toBe(true);
    expect(isResumeworthy(10, Number.NaN)).toBe(false);
  });
});

describe('formatClock()', () => {
  it('formats M:SS below an hour', () => {
    expect(formatClock(2535)).toBe('42:15');
    expect(formatClock(5)).toBe('0:05');
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65)).toBe('1:05');
  });

  it('formats H:MM:SS past an hour', () => {
    expect(formatClock(3903)).toBe('1:05:03');
    expect(formatClock(3600)).toBe('1:00:00');
  });

  it('floors fractional seconds and clamps negatives', () => {
    expect(formatClock(75.9)).toBe('1:15');
    expect(formatClock(-10)).toBe('0:00');
  });
});

describe('position store roundtrip', () => {
  it('writes and reads back a position for a title id', async () => {
    const a = createMemoryStorageAdapter();
    await writePosition(a, '42561', 2535, '/series/x/42561-y.html');
    expect(await readPosition(a, '42561')).toEqual({ t: 2535, path: '/series/x/42561-y.html' });
  });

  it('returns null for an unknown or blank id', async () => {
    const a = createMemoryStorageAdapter();
    expect(await readPosition(a, '999')).toBeNull();
    expect(await readPosition(a, null)).toBeNull();
  });

  it('ignores junk writes (blank id, non-positive time)', async () => {
    const a = createMemoryStorageAdapter();
    await writePosition(a, '', 100, '/x');
    await writePosition(a, '1', 0, '/x');
    await writePosition(a, '1', -5, '/x');
    expect(await readPosition(a, '1')).toBeNull();
  });

  it('clears a saved position', async () => {
    const a = createMemoryStorageAdapter();
    await writePosition(a, '7', 120, '/a');
    await clearPosition(a, '7');
    expect(await readPosition(a, '7')).toBeNull();
  });

  it('does not pollute Object.prototype via a hostile id', async () => {
    const a = createMemoryStorageAdapter();
    await writePosition(a, '__proto__', 120, '/x');
    expect(({} as Record<string, unknown>).t).toBeUndefined();
    expect(await readPosition(a, '__proto__')).toBeNull();
  });
});
