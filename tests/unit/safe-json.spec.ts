import { describe, expect, it } from 'vitest';
import { safeJsonParse } from '../../src/utils/safe-json';

describe('safeJsonParse', () => {
  it('parses valid JSON', () => {
    expect(safeJsonParse('{"a":1}', null)).toEqual({ a: 1 });
    expect(safeJsonParse('[1,2,3]', null)).toEqual([1, 2, 3]);
    expect(safeJsonParse('"x"', null)).toBe('x');
    expect(safeJsonParse('42', null)).toBe(42);
    expect(safeJsonParse('null', 'fb')).toBe(null);
  });

  it('returns the fallback on null/undefined/empty input', () => {
    expect(safeJsonParse(null, 'fb')).toBe('fb');
    expect(safeJsonParse(undefined, 'fb')).toBe('fb');
    expect(safeJsonParse('', 'fb')).toBe('fb');
  });

  it('returns the fallback on invalid JSON', () => {
    expect(safeJsonParse('{not json}', 42)).toBe(42);
    expect(safeJsonParse('}{', { x: 1 })).toEqual({ x: 1 });
  });

  it('preserves the fallback type via generic', () => {
    interface Foo {
      a: number;
    }
    const result = safeJsonParse<Foo>('not json', { a: 99 });
    expect(result.a).toBe(99);
  });
});
