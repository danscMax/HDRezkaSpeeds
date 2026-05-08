/**
 * SettingsStore -- hydrated sync getters, async write-through (audit C1).
 *
 *   bootstrap(ctx) does `await ctx.settingsStore.init(site)` exactly once.
 *   After that, every hot path (ratechange, hotkey listener, click handler,
 *   ui render) reads via `get()` / `getKey()` synchronously. Writes go
 *   through `update()` and persist asynchronously; callers don't await on
 *   the hot path, the next read stays consistent thanks to the in-memory
 *   mirror updated synchronously inside `update()`.
 */

import { storageKeysFor } from '../config';
import type { Site } from '../app/ports';
import type { StorageAdapter } from './adapter';
import { normalizeHotkeys } from './hotkey-migrate';
import { defaultSettings, type Settings } from './types';
import { detectBrowserLang } from '../i18n/detect';
import { SUPPORTED_LANGS, type Lang } from '../i18n/dict';

export interface SettingsStoreImpl {
  init(site: Site): Promise<void>;
  get(): Settings;
  getKey<K extends keyof Settings>(key: K): Settings[K];
  update(patch: Partial<Settings>): Promise<void>;
  subscribe(fn: (next: Settings) => void): () => void;
  /** Test/internal: clear the persisted settings for this site. */
  reset(): Promise<void>;
}

export function createSettingsStore(adapter: StorageAdapter): SettingsStoreImpl {
  let state: Settings | null = null;
  let storageKey: string | null = null;
  let initSite: Site | null = null;
  const subscribers = new Set<(next: Settings) => void>();

  function requireInit(): Settings {
    if (state === null) {
      throw new Error('SettingsStore: get() called before init()');
    }
    return state;
  }

  function notify(): void {
    if (state === null) return;
    const snapshot = state;
    for (const fn of subscribers) {
      try {
        fn(snapshot);
      } catch (e) {
        // One subscriber crashing must not stop the others, but we still
        // want a trace — silent swallow used to hide bugs in panel
        // rerender / theme observer for entire dev cycles.
        console.warn('[settings-store] subscriber threw:', e);
      }
    }
  }

  return {
    async init(site: Site): Promise<void> {
      storageKey = storageKeysFor(site).settings;
      initSite = site;
      const fallback = defaultSettings(detectBrowserLang(), site);
      const raw = await adapter.get<Partial<Settings> | null>(storageKey, null);

      // Build the live state by merging defaults with whatever made it through.
      // Each field is sanity-checked against its expected shape so a corrupt
      // disk write (or a TM migration of a third-party tool) can't poison
      // the in-memory state with stray strings/numbers.
      state = mergeAndValidate(raw, fallback);

      // First-install pin: when the disk has no prior value, write the
      // defaults back immediately. Otherwise a future version that
      // changes a default field would silently flip users who never
      // opened the gear menu — `mergeAndValidate(null, NEW_DEFAULTS)`
      // would just adopt the new defaults instead of preserving the
      // user's training. This costs one storage write per fresh-install.
      if (raw === null) {
        try {
          await adapter.set(storageKey, state);
        } catch {
          // Non-fatal: in-memory state is correct, the next update()
          // will retry the persist.
        }
      }
    },

    get(): Settings {
      return requireInit();
    },

    getKey<K extends keyof Settings>(key: K): Settings[K] {
      return requireInit()[key];
    },

    async update(patch: Partial<Settings>): Promise<void> {
      const current = requireInit();
      // Sanitize incoming patch before merge -- update() is reachable from
      // the import-settings flow (user-supplied JSON) and from the TM-
      // migration scan; both can carry partly malformed sub-shapes.
      // Trusted UI callers pay a tiny validation tax for a meaningful
      // safety net (audit M11).
      const safe = sanitizePatch(patch);
      // Defensive copy so callers can't mutate the previous snapshot held
      // by subscribers after this returns.
      state = { ...current, ...safe };
      notify();
      if (storageKey) {
        await adapter.set(storageKey, state);
      }
    },

    subscribe(fn): () => void {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },

    async reset(): Promise<void> {
      if (storageKey) {
        await adapter.remove(storageKey);
      }
      state = defaultSettings(detectBrowserLang(), initSite ?? undefined);
      notify();
    },
  };
}

function mergeAndValidate(
  raw: Partial<Settings> | null,
  defaults: Settings,
): Settings {
  return { ...defaults, ...sanitizePatch(raw, defaults) };
}

/**
 * Validate an arbitrary patch and return ONLY the keys that pass per-field
 * shape checks. Used by both `init` (merging into defaults) and `update`
 * (merging into the live state).
 *
 * Defensive against:
 *   - null / non-object inputs (typeof null === 'object' was the classic
 *     trap; explicit guards now)
 *   - top-level arrays that masquerade as records (typeof [] === 'object')
 *   - prototype-pollution shaped keys (`__proto__`, `constructor`,
 *     `prototype`) -- modern JSON.parse already strips `__proto__` but we
 *     belt-and-suspender it for any raw-object source (e.g. tests, future
 *     adapters)
 *   - corrupt sub-shapes (hotkeys === "x", language === 42, etc.) --
 *     each field falls back to its default independently rather than
 *     dragging the whole record down (audit M11).
 *
 * Note: the `defaults` arg is only consulted for the nested `hotkeys`
 * field where `normalizeHotkeys` needs a fallback per-action array. All
 * other fields are validated standalone -- caller spreads onto its own
 * baseline.
 */
function sanitizePatch(
  raw: unknown,
  defaults: Settings = ARRAY_FALLBACK_DEFAULTS,
): Partial<Settings> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  // Defensive snapshot: copy own enumerable string keys only, drop any
  // proto-pollution-shaped keys upfront. JSON.parse already does this in
  // modern engines; explicit defense for foreign call sites.
  const safe: Record<string, unknown> = Object.create(null);
  for (const k of Object.keys(raw as object)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    safe[k] = (raw as Record<string, unknown>)[k];
  }

  const out: Partial<Settings> = {};

  if (safe.sliderPosition === 'right' || safe.sliderPosition === 'bottom' || safe.sliderPosition === 'video') {
    out.sliderPosition = safe.sliderPosition;
  }
  if (typeof safe.rememberSpeed === 'boolean') out.rememberSpeed = safe.rememberSpeed;
  if (typeof safe.language === 'string' && (SUPPORTED_LANGS as readonly string[]).includes(safe.language)) {
    out.language = safe.language as Lang;
  }
  if (safe.hotkeys && typeof safe.hotkeys === 'object' && !Array.isArray(safe.hotkeys)) {
    const hk = safe.hotkeys as { speedUp?: unknown; speedDown?: unknown };
    out.hotkeys = {
      speedUp:   normalizeHotkeys(hk.speedUp,   defaults.hotkeys.speedUp),
      speedDown: normalizeHotkeys(hk.speedDown, defaults.hotkeys.speedDown),
    };
  }
  // speedPresets — array of finite numbers in (0, 10] (10x is the soft
  // ceiling of the manual-input UI). Filter out NaN, negatives, oversize
  // values so a corrupt disk write can't paint the panel with garbage
  // rows.
  if (Array.isArray(safe.speedPresets)) {
    const cleaned = (safe.speedPresets as unknown[])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 10)
      // Round to 2 decimals so 1.0000001-style float drift collapses to
      // a single entry, then de-dupe.
      .map((v) => Math.round(v * 100) / 100);
    out.speedPresets = Array.from(new Set(cleaned));
  }
  // speedStep — finite number in [0.01, 1.0]. 1.0 keeps the upper bound
  // useful (jump 0.5x→1.5x in two presses) while preventing absurd
  // values from a corrupt write.
  if (typeof safe.speedStep === 'number' && Number.isFinite(safe.speedStep)
      && safe.speedStep >= 0.01 && safe.speedStep <= 1.0) {
    out.speedStep = Math.round(safe.speedStep * 100) / 100;
  }
  // lastSeenTheme — only accept the two valid string values; anything
  // else means a corrupt write or a stale shape from an older version.
  if (safe.lastSeenTheme === 'dark' || safe.lastSeenTheme === 'light') {
    out.lastSeenTheme = safe.lastSeenTheme;
  }
  if (safe.__migrated_from_tm === true) out.__migrated_from_tm = true;

  return out;
}

// Last-ditch fallback hotkey defaults consulted only when a raw patch is
// validated WITHOUT a real `defaults` (sanitizePatch's update-path call).
// Mirrors `defaultSettings(...)` in storage/types.ts but inlined here so
// the validator can stand alone in tests.
const ARRAY_FALLBACK_DEFAULTS: Settings = {
  sliderPosition: 'right',
  rememberSpeed: true,
  language: 'en' as Lang,
  hotkeys: {
    speedUp:   [{ ctrl: true, shift: false, alt: false, meta: false, key: 'KeyC' }],
    speedDown: [{ ctrl: true, shift: false, alt: false, meta: false, key: 'KeyV' }],
  },
  speedPresets: [1, 1.5, 2],
  speedStep: 0.1,
};
