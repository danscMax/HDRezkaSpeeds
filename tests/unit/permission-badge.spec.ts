/**
 * The badge is the only surface left when the content script cannot run, so
 * "when exactly does it warn" is worth pinning. The rule that matters: it must
 * mean "the extension cannot work anywhere", not "one of eleven mirrors is
 * missing" — a warning that is usually wrong teaches people to ignore it.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  BADGE_ALERT_COLOR,
  BADGE_OK_COLOR,
  refreshPermissionBadge,
} from '../../src/health/permission-badge';

const surface = () => {
  const calls = { text: '', color: '', title: '' };
  return {
    calls,
    action: {
      setBadgeText: vi.fn(async ({ text }: { text: string }) => {
        calls.text = text;
      }),
      setBadgeBackgroundColor: vi.fn(async ({ color }: { color: string }) => {
        calls.color = color;
      }),
      setTitle: vi.fn(async ({ title }: { title: string }) => {
        calls.title = title;
      }),
    },
  };
};

const probe = (granted: (origins: string[]) => boolean) => ({
  contains: async ({ origins }: { origins: string[] }) => granted(origins),
});

const groups = [
  ['*://*.hdrezka.ag/*', '*://hdrezka.ag/*'],
  ['*://*.rezka.ag/*', '*://rezka.ag/*'],
  ['*://*.standby-rezka.tv/*', '*://standby-rezka.tv/*'],
];
const opts = { originGroups: groups, alertTitle: 'no access' };

describe('refreshPermissionBadge', () => {
  it('stays silent while every site is granted', async () => {
    const s = surface();
    const held = await refreshPermissionBadge(
      s.action,
      probe(() => true),
      opts,
    );
    expect(held).toBe(true);
    expect(s.calls.text).toBe('');
    expect(s.calls.color).toBe(BADGE_OK_COLOR);
    expect(s.calls.title).toBe('');
  });

  it('stays silent when ONE mirror is ungranted — the extension still works', async () => {
    // The false alarm this grouping exists to kill: a mirror added in an update
    // is never granted by Firefox, and the flat AND check lit a permanent "!".
    const s = surface();
    const held = await refreshPermissionBadge(
      s.action,
      probe((origins) => !origins[0]?.includes('standby-rezka.tv')),
      opts,
    );
    expect(held).toBe(true);
    expect(s.calls.text).toBe('');
  });

  it('warns only when no site at all is usable', async () => {
    const s = surface();
    const held = await refreshPermissionBadge(
      s.action,
      probe(() => false),
      opts,
    );
    expect(held).toBe(false);
    expect(s.calls.text).toBe('!');
    expect(s.calls.color).toBe(BADGE_ALERT_COLOR);
    expect(s.calls.title).toBe('no access');
  });

  it('treats an unanswerable probe as fine rather than crying wolf', async () => {
    const s = surface();
    const held = await refreshPermissionBadge(
      s.action,
      { contains: () => Promise.reject(new Error('API unavailable')) },
      opts,
    );
    expect(held).toBe(true);
    expect(s.calls.text).toBe('');
  });

  it('does nothing when there is nothing to check', async () => {
    const s = surface();
    const contains = vi.fn();
    const held = await refreshPermissionBadge(
      s.action,
      { contains: contains as never },
      { originGroups: [[]], alertTitle: 'x' },
    );
    expect(held).toBe(true);
    expect(contains).not.toHaveBeenCalled();
  });
});
