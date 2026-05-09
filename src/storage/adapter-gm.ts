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

// Audit 2026-05-09 sec C10: GM_setValue stores arbitrary types (number,
// boolean, string, object), but we want lossless JSON round-trips so the
// adapter is interchangeable with chrome.storage.local. The previous
// implementation wrote primitives raw and stringified objects, then on
// read it JSON-parse'd strings. Result: a stored string `"true"` /
// `"123"` / `"null"` round-tripped as `true`/`123`/`null`, which is
// type-bending corruption. Fix: always wrap in a JSON envelope
// `{"_v":1,"d":<value>}` so the read path can recover the exact original type.
const ENVELOPE_VERSION = 1;
type Envelope<T> = { _v: 1; d: T };

function isEnvelope(v: unknown): v is Envelope<unknown> {
  return (
    !!v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    (v as { _v?: unknown })._v === ENVELOPE_VERSION &&
    'd' in (v as object)
  );
}

function decodeRaw<T>(raw: unknown, defaultValue: T): T {
  if (raw === undefined || raw === null) return defaultValue;
  if (typeof raw === 'string') {
    const parsed = safeJsonParse<unknown | typeof SENTINEL>(raw, SENTINEL);
    if (parsed === SENTINEL) return raw as unknown as T;
    if (isEnvelope(parsed)) return parsed.d as T;
    return parsed as T;
  }
  if (isEnvelope(raw)) return raw.d as T;
  return raw as T;
}

function encodeForStorage<T>(value: T): string {
  return JSON.stringify({ _v: ENVELOPE_VERSION, d: value } satisfies Envelope<T>);
}

export function createGmStorageAdapter(): StorageAdapter {
  if (hasGmSync()) {
    return {
      async get<T>(key: string, defaultValue: T): Promise<T> {
        return decodeRaw<T>(g.GM_getValue!(key, undefined), defaultValue);
      },
      async set(key: string, value: unknown): Promise<void> {
        g.GM_setValue!(key, encodeForStorage(value));
      },
      async remove(key: string): Promise<void> {
        if (typeof g.GM_deleteValue === 'function') g.GM_deleteValue(key);
      },
    };
  }

  // Fallback: page localStorage. Same envelope contract as the GM branch.
  return {
    async get<T>(key: string, defaultValue: T): Promise<T> {
      try {
        const raw = localStorage.getItem(key);
        if (raw == null) return defaultValue;
        return decodeRaw<T>(raw, defaultValue);
      } catch {
        return defaultValue;
      }
    },
    async set(key: string, value: unknown): Promise<void> {
      try {
        localStorage.setItem(key, encodeForStorage(value));
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
