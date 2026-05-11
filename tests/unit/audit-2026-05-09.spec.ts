/**
 * Regression tests for the 2026-05-09 security + integrity audit (HDRezka edition).
 * Covers C1, C5, C9, C10, C11.
 */

import { describe, expect, it, vi } from 'vitest';
import { detectSite } from '../../src/sites/detect';
import {
  importSettingsFromText,
  buildExportEnvelope,
} from '../../src/ui/settings/export-import';
import { createSettingsStore } from '../../src/storage/settings-store';
import type { StorageAdapter } from '../../src/storage/adapter';
import { createGmStorageAdapter } from '../../src/storage/adapter-gm';
import { Validators } from '../../src/discovery/validators';
import type { AppContext } from '../../src/app/context';

// --- C1: hostname regex anchoring -------------------------------------

describe('audit C1: detectSite anchored to whole-host TLD', () => {
  it('matches canonical HDRezka mirrors', () => {
    expect(detectSite('hdrezka.ag')).toBe('hdrezka');
    expect(detectSite('www.hdrezka.ag')).toBe('hdrezka');
    expect(detectSite('rezka.ag')).toBe('hdrezka');
    expect(detectSite('hdrezka-home.tv')).toBe('hdrezka');
    expect(detectSite('rezkify.com')).toBe('hdrezka');
  });
  it('rejects substring spoofs', () => {
    expect(detectSite('hdrezka.evil.tld')).toBeNull();
    expect(detectSite('evil-hdrezka.com')).toBeNull();
    expect(detectSite('myhdrezka.community')).toBeNull();
    expect(detectSite('rezka.evil.tld')).toBeNull();
  });
  it('matches future TLDs of canonical names via wildcard', () => {
    // The TLD wildcard accepts e.g. hdrezka.cz / hdrezka.io as future mirrors.
    expect(detectSite('hdrezka.cz')).toBe('hdrezka');
    expect(detectSite('rezka.io')).toBe('hdrezka');
  });
  // Audit 2026-05-11 W3.6: removed isHDRezka — dead export. detectSite
  // is the live API; anchoring is verified above.
});

// --- C5: import schema validation -------------------------------------

function makeMemoryAdapter(): StorageAdapter & { _data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    _data: data,
    async get<T>(key: string, defaultValue: T): Promise<T> {
      return data.has(key) ? (data.get(key) as T) : defaultValue;
    },
    async set(key: string, value: unknown): Promise<void> {
      data.set(key, value);
    },
    async remove(key: string): Promise<void> {
      data.delete(key);
    },
  };
}

function makeCtx(adapter: StorageAdapter, site: 'hdrezka' = 'hdrezka') {
  const settingsStore = createSettingsStore(adapter);
  return {
    site,
    settingsStore,
    speedStore: { current: () => 1, smart: () => null },
  } as unknown as AppContext;
}

describe('audit C5: importSettingsFromText rejects malformed payloads', () => {
  it('rejects non-object JSON (array)', async () => {
    const adapter = makeMemoryAdapter();
    const ctx = makeCtx(adapter);
    await ctx.settingsStore.init('hdrezka');
    const r = await importSettingsFromText(ctx, JSON.stringify([1, 2, 3]));
    expect(r.ok).toBe(false);
  });

  it('rejects non-object JSON (number)', async () => {
    const adapter = makeMemoryAdapter();
    const ctx = makeCtx(adapter);
    await ctx.settingsStore.init('hdrezka');
    const r = await importSettingsFromText(ctx, JSON.stringify(42));
    expect(r.ok).toBe(false);
  });

  it('rejects bare object with no recognised keys', async () => {
    const adapter = makeMemoryAdapter();
    const ctx = makeCtx(adapter);
    await ctx.settingsStore.init('hdrezka');
    const r = await importSettingsFromText(ctx, JSON.stringify({ junk: 1, blah: 'x' }));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/no valid keys|unrecognized/i);
  });

  it('accepts a known-shape envelope and updates the recognised keys', async () => {
    const adapter = makeMemoryAdapter();
    const ctx = makeCtx(adapter);
    await ctx.settingsStore.init('hdrezka');
    const env = buildExportEnvelope(ctx);
    env.settings.rememberSpeed = false;
    const r = await importSettingsFromText(ctx, JSON.stringify(env));
    expect(r.ok).toBe(true);
    expect(ctx.settingsStore.getKey('rememberSpeed')).toBe(false);
  });

  it('rejects pure-junk envelope', async () => {
    const adapter = makeMemoryAdapter();
    const ctx = makeCtx(adapter);
    await ctx.settingsStore.init('hdrezka');
    const r = await importSettingsFromText(
      ctx,
      JSON.stringify({
        type: 'hdrezka-speeds-settings',
        version: 1,
        exportedAt: 'now',
        site: 'hdrezka',
        settings: { totallyUnknown: 42, foo: 'bar' },
      }),
    );
    expect(r.ok).toBe(false);
  });
});

// --- C9: settings-store rollback on adapter failure -------------------

describe('audit C9: SettingsStore rolls back on persist failure', () => {
  it('reverts in-memory state when adapter.set rejects', async () => {
    const adapter = makeMemoryAdapter();
    const ctx = makeCtx(adapter);
    await ctx.settingsStore.init('hdrezka');
    const before = ctx.settingsStore.getKey('rememberSpeed');

    let failNext = true;
    const original = adapter.set.bind(adapter);
    adapter.set = vi.fn(async (k, v) => {
      if (failNext) {
        failNext = false;
        throw new Error('quota exceeded');
      }
      return original(k, v);
    });

    await expect(
      ctx.settingsStore.update({ rememberSpeed: !before }),
    ).rejects.toThrow(/quota/);
    expect(ctx.settingsStore.getKey('rememberSpeed')).toBe(before);
  });

  it('serializes concurrent updates through the write chain', async () => {
    const adapter = makeMemoryAdapter();
    const ctx = makeCtx(adapter);
    await ctx.settingsStore.init('hdrezka');

    const writes: number[] = [];
    let counter = 0;
    const original = adapter.set.bind(adapter);
    adapter.set = vi.fn(async (k, v) => {
      const my = ++counter;
      await new Promise((r) => setTimeout(r, my === 1 ? 20 : 1));
      writes.push(my);
      return original(k, v);
    });

    await Promise.all([
      ctx.settingsStore.update({ rememberSpeed: false }),
      ctx.settingsStore.update({ rememberSpeed: true }),
    ]);
    expect(writes).toEqual([1, 2]);
    expect(ctx.settingsStore.getKey('rememberSpeed')).toBe(true);
  });
});

// --- C10: GM adapter envelope JSON round-trip -------------------------

describe('audit C10: GM-adapter envelope round-trips primitive types', () => {
  function withGmStubs<T>(fn: (store: Map<string, unknown>) => Promise<T>): Promise<T> {
    const store = new Map<string, unknown>();
    const g = globalThis as unknown as Record<string, unknown>;
    const restore = {
      GM_getValue: g.GM_getValue,
      GM_setValue: g.GM_setValue,
      GM_deleteValue: g.GM_deleteValue,
    };
    g.GM_getValue = (key: string, dv?: unknown) => (store.has(key) ? store.get(key) : dv);
    g.GM_setValue = (key: string, value: unknown) => {
      store.set(key, value);
    };
    g.GM_deleteValue = (key: string) => {
      store.delete(key);
    };
    return fn(store).finally(() => {
      g.GM_getValue = restore.GM_getValue;
      g.GM_setValue = restore.GM_setValue;
      g.GM_deleteValue = restore.GM_deleteValue;
    });
  }

  it('keeps strings as strings (was: parsed to bool/number/null on read)', async () => {
    await withGmStubs(async () => {
      const a = createGmStorageAdapter();
      await a.set('k', 'true');
      expect(await a.get<string>('k', '')).toBe('true');
      await a.set('k2', '42');
      expect(await a.get<string>('k2', '')).toBe('42');
      await a.set('k3', 'null');
      expect(await a.get<string>('k3', 'default')).toBe('null');
    });
  });

  it('round-trips numbers, booleans, objects, null', async () => {
    await withGmStubs(async () => {
      const a = createGmStorageAdapter();
      await a.set('n', 3.14);
      expect(await a.get<number>('n', 0)).toBe(3.14);
      await a.set('b', false);
      expect(await a.get<boolean>('b', true)).toBe(false);
      await a.set('o', { x: 1, y: 'two' });
      expect(await a.get<{ x: number; y: string }>('o', { x: 0, y: '' })).toEqual({ x: 1, y: 'two' });
      await a.set('z', null);
      expect(await a.get<null | string>('z', 'default')).toBe(null);
    });
  });

  it('returns defaultValue for missing keys', async () => {
    await withGmStubs(async () => {
      const a = createGmStorageAdapter();
      expect(await a.get<number>('missing', 99)).toBe(99);
    });
  });
});

// --- C11: validators ok() returns a fresh object ----------------------

describe('audit C11: Validators return a fresh ok-result on every call', () => {
  it('successive video validations return distinct objects', () => {
    const v = document.createElement('video');
    Object.defineProperty(v, 'tagName', { value: 'VIDEO', configurable: true });
    Object.defineProperty(v, 'isConnected', { value: true, configurable: true });
    Object.defineProperty(v, 'getBoundingClientRect', {
      value: () => ({ width: 800, height: 450, top: 0, left: 0, right: 800, bottom: 450 }),
      configurable: true,
    });
    Object.defineProperty(v, 'currentSrc', { value: 'https://x/y.mp4', configurable: true });
    const a = Validators.video(v);
    const b = Validators.video(v);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    a.reasons.push('test-mutation');
    expect(b.reasons).toEqual([]);
  });
});
