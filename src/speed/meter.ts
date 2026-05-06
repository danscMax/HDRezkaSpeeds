/**
 * RatechangeMeter -- a sliding 60-second window of `ratechange` events.
 *
 * Used by HealthChecker (Wave 1.9) to detect a "rate-resets storm": some
 * sites (RuTube, HDRezka) re-apply their default speed on the player every
 * couple of seconds, fighting our setting. perMinute() above ~15 indicates
 * we're losing the fight and should warn the user.
 *
 * Pure data structure -- no globals, no imports.
 *
 * Ported from .user.js:771-798.
 */

export interface RatechangeEvent {
  at: number;
  from: number | null;
  to: number | null;
}

export interface RatechangeMeter {
  tick(from: number | null | undefined, to: number | null | undefined): void;
  perMinute(): number;
  tail(n?: number): RatechangeEvent[];
  clear(): void;
}

const WINDOW_MS = 60_000;
const MAX_TAIL = 50;

export function createRatechangeMeter(now: () => number = Date.now): RatechangeMeter {
  const events: RatechangeEvent[] = [];

  function toFinite(v: unknown): number | null {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  return {
    tick(from, to): void {
      const at = now();
      events.push({ at, from: toFinite(from), to: toFinite(to) });
      const cutoff = at - WINDOW_MS;
      while (events.length && events[0]!.at < cutoff) events.shift();
      if (events.length > MAX_TAIL) events.splice(0, events.length - MAX_TAIL);
    },

    perMinute(): number {
      const cutoff = now() - WINDOW_MS;
      let count = 0;
      for (const e of events) if (e.at >= cutoff) count++;
      return count;
    },

    tail(n = 20): RatechangeEvent[] {
      return events.slice(-n).map((e) => ({ ...e }));
    },

    clear(): void {
      events.length = 0;
    },
  };
}
