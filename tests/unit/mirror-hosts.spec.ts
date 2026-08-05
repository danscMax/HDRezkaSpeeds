import { describe, expect, it } from 'vitest';
import { detectSite } from '../../src/sites/detect';
import {
  BUILTIN_MIRROR_HOSTS,
  builtinMatchPatterns,
  isCoveredByHostList,
  originPatternsFor,
  permissionGroupsFor,
} from '../../src/sites/mirror-hosts';

describe('permissionGroupsFor', () => {
  // The badge and the popup banner answer "do we have access?" off this one
  // list. They used to disagree — the popup asked a flat AND over every mirror
  // and nagged people whose own mirror worked.
  it('asks only about the mirror we last worked on', () => {
    expect(permissionGroupsFor('standby-rezka.tv')).toEqual([
      originPatternsFor('standby-rezka.tv'),
    ]);
  });

  it('falls back to one group per built-in mirror when there is no record', () => {
    const groups = permissionGroupsFor(null);
    expect(groups).toHaveLength(BUILTIN_MIRROR_HOSTS.length);
    // One group per SITE, not one flat list: a single ungranted mirror must not
    // speak for the other ten.
    expect(groups.every((g) => g.length === 2)).toBe(true);
    expect(groups.flat()).toEqual(builtinMatchPatterns());
  });
});

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

describe('every built-in mirror stays wired end to end', () => {
  // mirror-hosts.ts asks a human to "mirror the change" into detect.ts by hand.
  // A host present in the manifest patterns but missing from the detector is
  // exactly the failure this extension exists to survive: the mirror loads, the
  // content script is injected, and bootstrap then bails with "unsupported
  // host" — no panel, no error. One loop is cheaper than remembering.
  it.each([...BUILTIN_MIRROR_HOSTS])('detectSite recognises %s and its subdomains', (host) => {
    expect(detectSite(host)).toBe('hdrezka');
    expect(detectSite(`www.${host}`)).toBe('hdrezka');
  });

  it.each([...BUILTIN_MIRROR_HOSTS])('stays anchored against spoofing of %s', (host) => {
    expect(detectSite(`${host}.evil.com`)).toBeNull();
    expect(detectSite(`not${host}`)).toBeNull();
  });
});
