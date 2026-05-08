/**
 * GM-storage adapter -- bridges the StorageAdapter interface to
 * Tampermonkey/Violentmonkey's GM_setValue / GM_getValue family.
 *
 * Used only in the userscript build (Wave 3). The extension build never
 * imports this file. Detection happens at module top: if GM_setValue is a
 * function we use it; otherwise we fall back to page localStorage so the
 * userscript still works under unsupported managers (degraded -- no
 * cross-origin storage, but everything else stays functional).
 *
 * Storage-key shape matches the extension's: per-site `<site>-speed-
 * settings` and `<site>-selected-speed`, the SelectorCache `vs-cache:*`
 * etc. -- no migration needed; users carry their data forward by simply
 * uninstalling the userscript and installing the extension (or vice
 * versa) on the same domain.
 */

import { safeJsonParse } from '../utils/safe-json';
import type { StorageAdapter } from './adapter';

type GmGet = (key: string, defaultValue?: unknown) => unknown;
type GmSet = (key: string, value: unknown) => void;
type GmDel = (key: string) => void;

const g = globalThis as unknown as {
  GM_getValue?: GmGet;
  GM_setValue?: GmSet;
  GM_deleteValue?: GmDel;
  GM_listValues?: () => string[];
};

function hasGmSync(): boolean {
  return typeof g.GM_getValue === 'function' && typeof g.GM_setValue === 'function';
}

export function createGmStorageAdapter(): StorageAdapter {
  if (hasGmSync()) {
    return {
      async get<T>(key: string, defaultValue: T): Promise<T> {
        const raw = g.GM_getValue!(key, undefined);
        if (raw === undefined) return defaultValue;
        // GM_setValue stores arbitrary types; if a string came back, try
        // JSON-parse first (we serialize objects on write below). Otherwise
        // pass through whatever GM stored.
        if (typeof raw === 'string') {
          const parsed = safeJsonParse<T | typeof SENTINEL>(raw, SENTINEL);
          return parsed === SENTINEL ? (raw as unknown as T) : parsed;
        }
        return raw as T;
      },
      async set(key: string, value: unknown): Promise<void> {
        const stored = typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
        g.GM_setValue!(key, stored);
      },
      async remove(key: string): Promise<void> {
        if (typeof g.GM_deleteValue === 'function') g.GM_deleteValue(key);
      },
    };
  }

  // Fallback: page localStorage. Same write contract as the GM branch.
  return {
    async get<T>(key: string, defaultValue: T): Promise<T> {
      try {
        const raw = localStorage.getItem(key);
        if (raw == null) return defaultValue;
        const parsed = safeJsonParse<T | typeof SENTINEL>(raw, SENTINEL);
        return parsed === SENTINEL ? (raw as unknown as T) : parsed;
      } catch {
        return defaultValue;
      }
    },
    async set(key: string, value: unknown): Promise<void> {
      try {
        const stored =
          typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
        localStorage.setItem(key, stored);
      } catch {
        /* swallow quota / private-mode errors */
      }
    },
    async remove(key: string): Promise<void> {
      try {
        localStorage.removeItem(key);
      } catch {
        /* swallow */
      }
    },
  };
}

// Sentinel used to distinguish "JSON parse failed" from "stored value is
// literally null". Internal -- never exposed.
const SENTINEL = Symbol('gm-adapter-sentinel') as unknown as never;
