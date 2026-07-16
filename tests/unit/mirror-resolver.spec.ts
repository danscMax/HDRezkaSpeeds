import { describe, expect, it } from 'vitest';
import { orderMirrorCandidates } from '../../src/sites/mirror-resolver';

// Ordering for the popup "Open HDRezka" action (part C): last-known-good
// first, then user mirrors, then built-ins; de-duplicated, host-shape only.

describe('orderMirrorCandidates()', () => {
  it('puts the last-known-good host first', () => {
    const out = orderMirrorCandidates({
      lastHost: 'standby-rezka.tv',
      userHosts: ['my-mirror.tv'],
      builtinHosts: ['hdrezka.ag', 'rezka.ag'],
    });
    expect(out).toEqual(['standby-rezka.tv', 'my-mirror.tv', 'hdrezka.ag', 'rezka.ag']);
  });

  it('de-duplicates across all three sources (case-insensitive)', () => {
    const out = orderMirrorCandidates({
      lastHost: 'HDREZKA.ag',
      userHosts: ['hdrezka.ag', 'user.tv'],
      builtinHosts: ['hdrezka.ag', 'rezka.ag'],
    });
    expect(out).toEqual(['hdrezka.ag', 'user.tv', 'rezka.ag']);
  });

  it('handles a null / absent lastHost and empty inputs', () => {
    expect(orderMirrorCandidates({ lastHost: null, builtinHosts: ['hdrezka.ag'] })).toEqual([
      'hdrezka.ag',
    ]);
    expect(orderMirrorCandidates({})).toEqual([]);
  });

  it('skips empty / whitespace-only entries', () => {
    const out = orderMirrorCandidates({
      lastHost: '  ',
      userHosts: ['', 'good.tv'],
      builtinHosts: [],
    });
    expect(out).toEqual(['good.tv']);
  });
});
