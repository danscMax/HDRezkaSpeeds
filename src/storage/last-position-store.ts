/**
 * Resume positions ("continue where you left off"). Keyed by the caller's
 * per-episode key (title id + active season/episode — see
 * extractHDRezkaEpisodeKey); a movie falls back to the bare title id. Unlike
 * FEAT-015 speed memory (deliberately per-series), resume must be per-episode
 * or episode 2 would be offered episode 1's position.
 *
 * Mirrors the speed-store per-content map (createSpeedStore): a plain
 * `Record<titleId, entry>` object, capped at POSITION_LIMIT with LRU
 * eviction by write time, prototype-pollution-guarded keys, and defensive
 * validation on hydrate. Kept under its OWN storage key (not the settings
 * blob) so the throttled timeupdate writes never notify settings
 * subscribers / trigger a panel rerender.
 *
 * The store is a dumb persist/read/clear of the map — the CALLER (the
 * content-script tracker) decides WHEN a position is worth remembering
 * (via isResumeworthy) so this stays pure and unit-testable.
 */

import type { StorageAdapter } from './adapter';

export const LAST_POSITION_STORAGE_KEY = 'hdrezka-last-position';

/** Cap the map — 200 titles is months of binging. Mirrors speed-store. */
const POSITION_LIMIT = 200;

/** Ignore the first 30s (intros/recaps) — not a meaningful resume point. */
const MIN_POSITION_S = 30;
/** Within this of the end == effectively finished; don't offer a resume. */
const NEAR_END_S = 90;

interface PositionEntry {
  /** Seconds into the video. */
  t: number;
  /** Page path where it was watched (for a future "resume this" popup row). */
  p: string;
  /** Epoch ms of the write — LRU eviction key. */
  at: number;
}

export interface SavedPosition {
  t: number;
  path: string;
}

/** Reject prototype-pollution keys as map indices (defence in depth — the
 *  live key is always a numeric HDRezka title id). */
function isSafeKey(k: string): boolean {
  return k !== '__proto__' && k !== 'constructor' && k !== 'prototype';
}

async function loadMap(adapter: StorageAdapter): Promise<Record<string, PositionEntry>> {
  const raw = await adapter.get<Record<string, unknown> | null>(LAST_POSITION_STORAGE_KEY, null);
  const out: Record<string, PositionEntry> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const k of Object.keys(raw)) {
    if (!isSafeKey(k)) continue;
    const e = raw[k] as { t?: unknown; p?: unknown; at?: unknown } | null;
    if (e && typeof e === 'object' && typeof e.t === 'number' && Number.isFinite(e.t) && e.t > 0) {
      out[k] = {
        t: e.t,
        p: typeof e.p === 'string' ? e.p : '',
        at: typeof e.at === 'number' ? e.at : 0,
      };
    }
  }
  return out;
}

/** Read the saved resume position for `titleId`, or null. */
export async function readPosition(
  adapter: StorageAdapter,
  titleId: string | null,
): Promise<SavedPosition | null> {
  if (!titleId || !isSafeKey(titleId)) return null;
  const map = await loadMap(adapter);
  // Own-property check: map['__proto__'] etc. would otherwise resolve to
  // Object.prototype and read back as a bogus entry.
  if (!Object.hasOwn(map, titleId)) return null;
  const e = map[titleId];
  return e ? { t: e.t, path: e.p } : null;
}

/**
 * Persist `t` seconds as the resume point for `titleId`. Read-modify-write
 * with LRU eviction — cheap because the caller throttles to ~5s. Silently
 * no-ops on a blank id.
 */
export async function writePosition(
  adapter: StorageAdapter,
  titleId: string | null,
  t: number,
  path: string,
): Promise<void> {
  if (!titleId || !isSafeKey(titleId) || !Number.isFinite(t) || t <= 0) return;
  const map = await loadMap(adapter);
  map[titleId] = { t, p: path, at: Date.now() };
  const keys = Object.keys(map);
  if (keys.length > POSITION_LIMIT) {
    const keep = keys.sort((a, b) => (map[b]?.at ?? 0) - (map[a]?.at ?? 0)).slice(0, POSITION_LIMIT);
    const next: Record<string, PositionEntry> = {};
    for (const k of keep) {
      const e = map[k];
      if (e) next[k] = e;
    }
    await adapter.set(LAST_POSITION_STORAGE_KEY, next);
    return;
  }
  await adapter.set(LAST_POSITION_STORAGE_KEY, map);
}

/** Drop the saved position for `titleId` (e.g. the title was finished). */
export async function clearPosition(
  adapter: StorageAdapter,
  titleId: string | null,
): Promise<void> {
  if (!titleId || !isSafeKey(titleId)) return;
  const map = await loadMap(adapter);
  if (!(titleId in map)) return;
  delete map[titleId];
  await adapter.set(LAST_POSITION_STORAGE_KEY, map);
}

/**
 * Is `t` seconds into a `duration`-second video worth offering as a resume
 * point? Past the intro, before the credits. Duration is optional (HLS may
 * not know it yet) — then only the lower bound applies. Pure.
 */
export function isResumeworthy(t: number, duration: number): boolean {
  if (!Number.isFinite(t) || t < MIN_POSITION_S) return false;
  if (Number.isFinite(duration) && duration > 0 && t > duration - NEAR_END_S) return false;
  return true;
}

/** Format seconds as `M:SS` (or `H:MM:SS` past an hour). Pure. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
