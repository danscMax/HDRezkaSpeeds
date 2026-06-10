/**
 * SpeedStore -- holds the user's currently selected speed plus an optional
 * "smart" override for one-shot temporary changes (see Wave 1.7).
 *
 * Same hydrate-then-sync contract as SettingsStore. Hot paths (ratechange
 * listener, controller.setSpeed) call `current()` / `setCurrent(...)`
 * without awaiting; persistence is fire-and-forget.
 */

import type { Site } from '../app/ports';
import { speedBoundsFor, storageKeysFor } from '../config';
import type { StorageAdapter } from './adapter';

export interface SpeedStoreImpl {
  init(site: Site): Promise<void>;
  current(): number;
  smart(): number | null;
  setCurrent(speed: number): Promise<void>;
  setSmart(speed: number | null): Promise<void>;
  /** FEAT-015: per-content speed memory. The orchestrator sets the key
   *  for the current page (HDRezka title id / YouTube channel); the
   *  controller records into it and pickInitialSpeed reads from it when
   *  the rememberPerVideo setting is on. */
  setActiveMemoryKey(key: string | null): void;
  activeMemoryKey(): string | null;
  /** Speed remembered for the ACTIVE key, or null. */
  activeMemory(): number | null;
  rememberForActive(speed: number): Promise<void>;
}

/** FEAT-015: cap the per-content memory map. Oldest entries (by write
 *  time) are evicted first — 200 titles/channels is months of binging. */
const MEMORY_LIMIT = 200;
interface MemoryEntry {
  s: number;
  at: number;
}

export function createSpeedStore(adapter: StorageAdapter): SpeedStoreImpl {
  let state: { current: number; smart: number | null } | null = null;
  let storageKey: string | null = null;
  let bounds: { min: number; max: number; defaultSpeed: number } | null = null;
  let memory: Record<string, MemoryEntry> = {};
  let memoryKey: string | null = null;
  let activeKey: string | null = null;

  function requireInit(): { current: number; smart: number | null } {
    if (state === null) {
      throw new Error('SpeedStore: accessed before init()');
    }
    return state;
  }

  function clamp(speed: number): number {
    if (!bounds) return speed;
    if (Number.isNaN(speed) || !Number.isFinite(speed)) return bounds.defaultSpeed;
    return Math.min(bounds.max, Math.max(bounds.min, speed));
  }

  return {
    async init(site: Site): Promise<void> {
      storageKey = storageKeysFor(site).speed;
      bounds = speedBoundsFor(site);

      const raw = await adapter.get<string | number | null>(storageKey, null);
      let parsed: number;
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        parsed = raw;
      } else if (typeof raw === 'string') {
        const f = parseFloat(raw);
        parsed = Number.isFinite(f) ? f : bounds.defaultSpeed;
      } else {
        parsed = bounds.defaultSpeed;
      }

      state = {
        current: clamp(parsed),
        smart: null, // never persisted across reloads
      };

      // FEAT-015: hydrate the per-content memory map. Malformed entries
      // (corrupt write, future shape) are dropped silently.
      memoryKey = `${storageKey}:memory`;
      const rawMem = await adapter.get<Record<string, unknown> | null>(memoryKey, null);
      memory = {};
      if (rawMem && typeof rawMem === 'object' && !Array.isArray(rawMem)) {
        for (const k of Object.keys(rawMem)) {
          if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
          const e = rawMem[k] as { s?: unknown; at?: unknown } | null;
          if (
            e &&
            typeof e === 'object' &&
            typeof e.s === 'number' &&
            Number.isFinite(e.s) &&
            e.s > 0 &&
            e.s <= 16
          ) {
            memory[k] = { s: e.s, at: typeof e.at === 'number' ? e.at : 0 };
          }
        }
      }
    },

    current(): number {
      return requireInit().current;
    },

    smart(): number | null {
      return requireInit().smart;
    },

    async setCurrent(speed: number): Promise<void> {
      const next = clamp(speed);
      requireInit().current = next;
      if (storageKey) {
        // Stored as a number for forward compat; the userscript wrote it as a
        // string so the migration path coerces both shapes back in init().
        await adapter.set(storageKey, next);
      }
    },

    async setSmart(speed: number | null): Promise<void> {
      requireInit().smart = speed === null ? null : clamp(speed);
    },

    setActiveMemoryKey(key: string | null): void {
      activeKey = key;
    },

    activeMemoryKey(): string | null {
      return activeKey;
    },

    activeMemory(): number | null {
      if (!activeKey) return null;
      const e = memory[activeKey];
      return e ? clamp(e.s) : null;
    },

    async rememberForActive(speed: number): Promise<void> {
      if (!activeKey || !memoryKey) return;
      memory[activeKey] = { s: clamp(speed), at: Date.now() };
      // LRU eviction by write time: keep the freshest MEMORY_LIMIT keys.
      const keys = Object.keys(memory);
      if (keys.length > MEMORY_LIMIT) {
        const keep = keys
          .sort((a, b) => (memory[b]?.at ?? 0) - (memory[a]?.at ?? 0))
          .slice(0, MEMORY_LIMIT);
        const next: Record<string, MemoryEntry> = {};
        for (const k of keep) {
          const e = memory[k];
          if (e) next[k] = e;
        }
        memory = next;
      }
      await adapter.set(memoryKey, memory);
    },
  };
}
