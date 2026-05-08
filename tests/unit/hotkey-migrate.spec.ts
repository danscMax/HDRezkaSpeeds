import { describe, expect, it } from 'vitest';
import { normalizeHotkeys } from '../../src/storage/hotkey-migrate';
import type { Hotkey } from '../../src/storage/types';

const defaults: Hotkey[] = [{ ctrl: true, shift: false, alt: false, meta: false, key: 'KeyC' }];

const valid: Hotkey = {
  ctrl: false,
  shift: true,
  alt: false,
  meta: false,
  key: 'F2',
};

describe('normalizeHotkeys', () => {
  it('returns defaults when value is null/undefined', () => {
    expect(normalizeHotkeys(null, defaults)).toBe(defaults);
    expect(normalizeHotkeys(undefined, defaults)).toBe(defaults);
  });

  it('returns defaults when value is empty array', () => {
    expect(normalizeHotkeys([], defaults)).toBe(defaults);
  });

  it('returns defaults when value is malformed (non-object/non-array)', () => {
    expect(normalizeHotkeys('Ctrl+C', defaults)).toBe(defaults);
    expect(normalizeHotkeys(42, defaults)).toBe(defaults);
    expect(normalizeHotkeys(true, defaults)).toBe(defaults);
  });

  it('wraps a single Hotkey object (legacy format) in an array', () => {
    expect(normalizeHotkeys(valid, defaults)).toEqual([valid]);
  });

  it('passes a non-empty valid array through', () => {
    expect(normalizeHotkeys([valid], defaults)).toEqual([valid]);
  });

  it('filters out malformed entries from a mixed array', () => {
    const mixed = [valid, { ctrl: true }, null, valid];
    expect(normalizeHotkeys(mixed, defaults)).toEqual([valid, valid]);
  });

  it('returns defaults when the array contains only invalid entries', () => {
    expect(normalizeHotkeys([null, { foo: 1 }, 'bad'], defaults)).toBe(defaults);
  });

  it('keeps entries with empty key string (placeholder slot for new hotkey)', () => {
    // Empty-key slots represent a freshly-added placeholder the user
    // hasn't filled in yet. They never match a real keypress (event.code
    // is always non-empty), so they're safe to retain through migration.
    // Audit C3.2 / new-slot empty placeholder.
    const empty = { ctrl: true, shift: false, alt: false, meta: false, key: '' };
    expect(normalizeHotkeys([empty], defaults)).toEqual([empty]);
  });
});
