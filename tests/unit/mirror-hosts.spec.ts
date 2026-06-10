import { describe, expect, it } from 'vitest';
import { detectSite } from '../../src/sites/detect';
import {
  BUILTIN_MIRROR_HOSTS,
  builtinMatchPatterns,
  isCoveredByHostList,
  originPatternsFor,
} from '../../src/sites/mirror-hosts';

describe('originPatternsFor', () => {
  it('returns the wildcard-subdomain + bare-apex pair', () => {
    expect(originPatternsFor('standby-rezka.tv')).toEqual([
      '*://*.standby-rezka.tv/*',
      '*://standby-rezka.tv/*',
    ]);
  });
});

describe('builtinMatchPatterns', () => {
  it('emits 2 patterns per built-in host', () => {
    const patterns = builtinMatchPatterns();
    expect(patterns).toHaveLength(BUILTIN_MIRROR_HOSTS.length * 2);
    // 11 hosts as of 0.5.0 (10 originals + standby-rezka.tv).
    expect(patterns).toHaveLength(22);
  });

  it('keeps the historical wildcard-then-bare ordering', () => {
    const patterns = builtinMatchPatterns();
    expect(patterns[0]).toBe('*://*.hdrezka.ag/*');
    expect(patterns[1]).toBe('*://hdrezka.ag/*');
  });

  it('includes standby-rezka.tv (0.5.0 addition)', () => {
    const patterns = builtinMatchPatterns();
    expect(patterns).toContain('*://standby-rezka.tv/*');
    expect(patterns).toContain('*://*.standby-rezka.tv/*');
  });
});

describe('isCoveredByHostList', () => {
  const list = ['rezka.ag', 'mirror.tv'];

  it('matches exact hosts and subdomains', () => {
    expect(isCoveredByHostList('rezka.ag', list)).toBe(true);
    expect(isCoveredByHostList('www.rezka.ag', list)).toBe(true);
    expect(isCoveredByHostList('a.b.mirror.tv', list)).toBe(true);
  });

  it('does NOT match lookalike suffixes (dot-anchored)', () => {
    expect(isCoveredByHostList('evil-rezka.ag', list)).toBe(false);
    expect(isCoveredByHostList('notmirror.tv', list)).toBe(false);
    expect(isCoveredByHostList('rezka.ag.evil.com', list)).toBe(false);
  });

  it('handles empty lists', () => {
    expect(isCoveredByHostList('rezka.ag', [])).toBe(false);
  });
});

describe('detectSite: standby-rezka.tv (0.5.0)', () => {
  it('detects the new built-in mirror and its subdomains', () => {
    expect(detectSite('standby-rezka.tv')).toBe('hdrezka');
    expect(detectSite('www.standby-rezka.tv')).toBe('hdrezka');
  });

  it('stays anchored against spoofing', () => {
    expect(detectSite('standby-rezka.tv.evil.com')).toBeNull();
    expect(detectSite('notstandby-rezka.tv')).toBeNull();
  });
});
