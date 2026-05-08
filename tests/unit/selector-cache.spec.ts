import { beforeEach, describe, expect, it } from 'vitest';
import { SELECTOR_CACHE_PREFIX } from '../../src/config';
import { createSelectorCache } from '../../src/discovery/cache';
import { createMemoryStorageAdapter } from '../../src/storage/adapter';

const HOST = 'test.example.com';
const STORAGE_KEY = `${SELECTOR_CACHE_PREFIX}${HOST}`;
const VERSION = '1.0.0';

beforeEach(() => {
  document.body.innerHTML = '';
});

function makeCache(initial?: Record<string, unknown>) {
  const adapter = createMemoryStorageAdapter(initial);
  const cache = createSelectorCache(adapter, {
    host: HOST,
    scriptVersion: VERSION,
  });
  return { adapter, cache };
}

async function flushPending(
  adapter: ReturnType<typeof createMemoryStorageAdapter>,
): Promise<unknown> {
  // Persistence is a fire-and-forget chained Promise. A single setTimeout
  // round flushes both the .then() callback and the adapter.set() that it
  // schedules; setting it to 0 yields the macrotask we need.
  await new Promise<void>((r) => setTimeout(r, 0));
  return adapter.get(STORAGE_KEY, null);
}

describe('SelectorCache', () => {
  describe('hydrate()', () => {
    it('starts not-ready', () => {
      const { cache } = makeCache();
      expect(cache.isReady()).toBe(false);
    });

    it('flips to ready after hydrate, even with empty storage', async () => {
      const { cache } = makeCache();
      await cache.hydrate();
      expect(cache.isReady()).toBe(true);
      expect(cache.get('video')).toBe(null);
    });

    it('loads matching schema + script_version entries', async () => {
      const { cache } = makeCache({
        [STORAGE_KEY]: {
          schema_version: 1,
          script_version: VERSION,
          entries: {
            video: {
              selector: 'video',
              source: 'exact',
              confidence: 0.9,
              signature: 'sig',
              found_at: 1,
              last_used_at: 1,
              valid_until: 9999999999999,
              success_count: 0,
              last_failure_count: 0,
            },
          },
        },
      });
      await cache.hydrate();
      expect(cache.get('video')?.selector).toBe('video');
    });

    it('drops mismatched script_version', async () => {
      const { adapter, cache } = makeCache({
        [STORAGE_KEY]: {
          schema_version: 1,
          script_version: 'OLD',
          entries: { video: { selector: 'video' } as never },
        },
      });
      await cache.hydrate();
      expect(cache.get('video')).toBe(null);
      // Persisted bag was removed.
      expect(await adapter.get(STORAGE_KEY, 'gone')).toBe('gone');
    });
  });

  describe('set() / get()', () => {
    it('stores an exact entry and reads it back synchronously', async () => {
      const { cache } = makeCache();
      await cache.hydrate();
      cache.set('video', {
        selector: 'video',
        source: 'exact',
        confidence: 0.9,
        signature: 'sig',
      });
      expect(cache.get('video')?.selector).toBe('video');
    });

    it('persists the new entry to the adapter', async () => {
      const { adapter, cache } = makeCache();
      await cache.hydrate();
      cache.set('playerContainer', {
        selector: '#player',
        source: 'exact',
        confidence: 0.9,
        signature: 'sig',
      });
      const persisted = (await flushPending(adapter)) as {
        entries: Record<string, { selector: string }>;
      };
      expect(persisted?.entries?.playerContainer?.selector).toBe('#player');
    });

    it('does NOT commit a heuristic entry until two matching signatures', async () => {
      const { cache } = makeCache();
      await cache.hydrate();
      cache.set('video', {
        selector: 'video',
        source: 'heuristic',
        confidence: 0.4,
        signature: 'sigA',
      });
      expect(cache.get('video')).toBe(null);

      // Different signature -> still not committed.
      cache.set('video', {
        selector: 'video',
        source: 'heuristic',
        confidence: 0.4,
        signature: 'sigB',
      });
      expect(cache.get('video')).toBe(null);

      // Same signature twice in a row -> commits.
      cache.set('video', {
        selector: 'video',
        source: 'heuristic',
        confidence: 0.4,
        signature: 'sigB',
      });
      expect(cache.get('video')?.selector).toBe('video');
    });
  });

  describe('bumpSuccess / bumpFailure / purge', () => {
    it('bumpSuccess increments success_count and resets failures', async () => {
      const { cache } = makeCache();
      await cache.hydrate();
      cache.set('video', {
        selector: 'video',
        source: 'exact',
        confidence: 0.9,
        signature: 'sig',
      });
      cache.bumpSuccess('video');
      cache.bumpSuccess('video');
      const entry = cache.get('video');
      expect(entry?.success_count).toBe(2);
      expect(entry?.last_failure_count).toBe(0);
    });

    it('bumpFailure returns true on threshold and purges the entry', async () => {
      const { cache } = makeCache();
      await cache.hydrate();
      cache.set('video', {
        selector: 'video',
        source: 'exact',
        confidence: 0.9,
        signature: 'sig',
      });
      expect(cache.bumpFailure('video')).toBe(false);
      expect(cache.bumpFailure('video')).toBe(false);
      expect(cache.bumpFailure('video')).toBe(true);
      expect(cache.get('video')).toBe(null);
    });

    it('purge() drops the entry and persists removal', async () => {
      const { adapter, cache } = makeCache();
      await cache.hydrate();
      cache.set('video', {
        selector: 'video',
        source: 'exact',
        confidence: 0.9,
        signature: 'sig',
      });
      cache.purge('video');
      expect(cache.get('video')).toBe(null);

      const persisted = (await flushPending(adapter)) as { entries: Record<string, unknown> };
      expect(persisted?.entries?.video).toBeUndefined();
    });

    it('purgeAll() clears in-memory + storage', async () => {
      const { adapter, cache } = makeCache();
      await cache.hydrate();
      cache.set('video', {
        selector: 'video',
        source: 'exact',
        confidence: 0.9,
        signature: 'sig',
      });
      await cache.purgeAll();
      expect(cache.get('video')).toBe(null);
      expect(await adapter.get(STORAGE_KEY, 'gone')).toBe('gone');
    });
  });

  describe('tryRestoreBackup() (audit M12)', () => {
    it('returns null when no entry has ever been written for the key', async () => {
      const { cache } = makeCache();
      await cache.hydrate();
      expect(cache.tryRestoreBackup('video')).toBe(null);
    });

    it('returns null after the first set() (no signature drift yet)', async () => {
      const { cache } = makeCache();
      await cache.hydrate();
      cache.set('video', {
        selector: 'video',
        source: 'exact',
        confidence: 0.9,
        signature: 'sig-A',
      });
      expect(cache.tryRestoreBackup('video')).toBe(null);
    });

    it('archives the previous entry when signature changes', async () => {
      const { cache } = makeCache();
      await cache.hydrate();
      cache.set('video', {
        selector: 'video.v1',
        source: 'exact',
        confidence: 0.9,
        signature: 'sig-A',
      });
      cache.set('video', {
        selector: 'video.v2',
        source: 'exact',
        confidence: 0.9,
        signature: 'sig-B',
      });
      expect(cache.tryRestoreBackup('video')?.selector).toBe('video.v1');
      expect(cache.tryRestoreBackup('video')?.signature).toBe('sig-A');
    });

    it('does NOT archive when signature is unchanged', async () => {
      const { cache } = makeCache();
      await cache.hydrate();
      cache.set('video', {
        selector: 'video.v1',
        source: 'exact',
        confidence: 0.9,
        signature: 'sig-A',
      });
      cache.set('video', {
        selector: 'video.v1-bumped',
        source: 'exact',
        confidence: 0.9,
        signature: 'sig-A',
      });
      expect(cache.tryRestoreBackup('video')).toBe(null);
    });

    it('persists backup map across hydrate cycles', async () => {
      const { adapter, cache } = makeCache();
      await cache.hydrate();
      cache.set('video', {
        selector: 'video.v1',
        source: 'exact',
        confidence: 0.9,
        signature: 'sig-A',
      });
      cache.set('video', {
        selector: 'video.v2',
        source: 'exact',
        confidence: 0.9,
        signature: 'sig-B',
      });
      await flushPending(adapter);

      const cache2 = createSelectorCache(adapter, { host: HOST, scriptVersion: VERSION });
      await cache2.hydrate();
      expect(cache2.tryRestoreBackup('video')?.selector).toBe('video.v1');
    });

    it('purge() drops backup too', async () => {
      const { cache } = makeCache();
      await cache.hydrate();
      cache.set('video', {
        selector: 'video.v1',
        source: 'exact',
        confidence: 0.9,
        signature: 'sig-A',
      });
      cache.set('video', {
        selector: 'video.v2',
        source: 'exact',
        confidence: 0.9,
        signature: 'sig-B',
      });
      cache.purge('video');
      expect(cache.tryRestoreBackup('video')).toBe(null);
    });
  });

  describe('buildSignature()', () => {
    it('returns a deterministic string for a stable element', async () => {
      const { cache } = makeCache();
      await cache.hydrate();
      const div = document.createElement('div');
      div.className = 'foo bar';
      div.setAttribute('role', 'main');
      document.body.appendChild(div);

      const sig1 = cache.buildSignature(div);
      const sig2 = cache.buildSignature(div);
      expect(sig1).toBe(sig2);
      expect(sig1).toContain('DIV');
      expect(sig1).toContain('foo bar');
      expect(sig1).toContain('main');
    });
  });
});
