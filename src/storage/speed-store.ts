/**
 * SpeedStore -- holds the user's currently selected speed plus an optional
 * "smart" override for one-shot temporary changes (see Wave 1.7).
 *
 * Same hydrate-then-sync contract as SettingsStore. Hot paths (ratechange
 * listener, controller.setSpeed) call `current()` / `setCurrent(...)`
 * without awaiting; persistence is fire-and-forget.
 */

import { speedBoundsFor, storageKeysFor } from '../config';
import type { Site } from '../app/ports';
import type { StorageAdapter } from './adapter';

export interface SpeedStoreImpl {
  init(site: Site): Promise<void>;
  current(): number;
  smart(): number | null;
  setCurrent(speed: number): Promise<void>;
  setSmart(speed: number | null): Promise<void>;
}

export function createSpeedStore(adapter: StorageAdapter): SpeedStoreImpl {
  let state: { current: number; smart: number | null } | null = null;
  let storageKey: string | null = null;
  let bounds: { min: number; max: number; defaultSpeed: number } | null = null;

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
  };
}
