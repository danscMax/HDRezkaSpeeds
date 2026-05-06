/**
 * Thin promise-based wrapper over `browser.storage.local`.
 *
 * Two impls live here:
 *   - createBrowserStorageAdapter()  -- production. Talks to wxt/browser.
 *   - createMemoryStorageAdapter()   -- tests + popup preview. Pure Map.
 *
 * Anything above this layer (SettingsStore, SpeedStore, SelectorCache,
 * migration) takes a `StorageAdapter` instance so tests can swap in a
 * deterministic backend without monkey-patching globals.
 */

import { browser } from 'wxt/browser';

export interface StorageAdapter {
  /** Resolve to the stored value, or `defaultValue` if the key is absent. */
  get<T>(key: string, defaultValue: T): Promise<T>;
  /** Persist value. Resolves once the write is committed. */
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

/**
 * MV3 dev-reload safety: after the extension is reloaded (or the user
 * disables/re-enables it) the OLD content-script lingers on the page until
 * navigation or HMR rips it out. Any in-flight `browser.storage.*` call on
 * that lingering instance rejects with "Extension context invalidated".
 *
 * Because many call sites fire-and-forget storage writes (e.g.
 * `void ctx.speedStore.setCurrent(...)` from a ratechange listener), the
 * rejection bubbles up as an unhandled promise rejection and lands in the
 * Chrome extension errors panel — even though nothing is actually broken.
 *
 * We swallow ONLY this specific error here; anything else still throws so
 * real storage failures (quota exceeded, Firefox storage migration
 * glitches, etc.) remain visible.
 */
function isContextInvalidated(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /extension context (?:was )?invalidated/i.test(err.message);
}

/**
 * Returns false once the extension context has been invalidated (reload,
 * disable, browser shutdown). chrome.runtime.id flips to undefined at that
 * point, so we can short-circuit the storage call BEFORE it throws — saves
 * one rejection per fire-and-forget caller. The try/catch around the
 * runtime probe is defensive: some browsers can throw on attribute access
 * inside a dying context.
 */
function isContextAlive(): boolean {
  try {
    const cr = (globalThis as { chrome?: { runtime?: { id?: string } } }).chrome?.runtime;
    return cr?.id != null;
  } catch {
    return false;
  }
}

export function createBrowserStorageAdapter(): StorageAdapter {
  // browser.storage.local works for both Chrome MV3 and Firefox MV3 via WXT's
  // unified `browser` shim. No callbacks-vs-promises ceremony needed.
  const store = browser.storage.local;

  return {
    async get<T>(key: string, defaultValue: T): Promise<T> {
      if (!isContextAlive()) return defaultValue;
      try {
        const result = await store.get(key);
        const v = (result as Record<string, unknown>)[key];
        return v === undefined ? defaultValue : (v as T);
      } catch (e) {
        if (isContextInvalidated(e)) return defaultValue;
        throw e;
      }
    },
    async set(key: string, value: unknown): Promise<void> {
      if (!isContextAlive()) return;
      try {
        await store.set({ [key]: value });
      } catch (e) {
        if (isContextInvalidated(e)) return;
        throw e;
      }
    },
    async remove(key: string): Promise<void> {
      if (!isContextAlive()) return;
      try {
        await store.remove(key);
      } catch (e) {
        if (isContextInvalidated(e)) return;
        throw e;
      }
    },
  };
}

export function createMemoryStorageAdapter(
  initial?: Record<string, unknown>,
): StorageAdapter {
  const map = new Map<string, unknown>(
    initial ? Object.entries(initial) : undefined,
  );
  return {
    async get<T>(key: string, defaultValue: T): Promise<T> {
      return map.has(key) ? (map.get(key) as T) : defaultValue;
    },
    async set(key: string, value: unknown): Promise<void> {
      map.set(key, value);
    },
    async remove(key: string): Promise<void> {
      map.delete(key);
    },
  };
}
