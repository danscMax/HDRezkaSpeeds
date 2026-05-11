/**
 * Coalescing wrapper over a StorageAdapter.
 *
 * Audit 2026-05-09 perf O1: a held hotkey (or a non-coalesced caller
 * misbehaving) can flood storage at 120+ writes/sec, blowing through
 * Chrome's 120-writes-per-minute quota in under a second. The slider
 * drag path already has its own rAF coalescing inside the controller,
 * but every other call site (hotkey repeat, settings.update bursts,
 * cache.bumpSuccess) goes straight to the underlying adapter.
 *
 * This wrapper buffers writes per-key for `flushMs` (default 200ms) and
 * collapses bursts into a single underlying `set()`. Last write wins.
 * Reads are pass-through but check the pending buffer first so
 * `get(k)` immediately after `set(k, v)` returns `v` instead of the
 * pre-burst value.
 *
 * `remove()` flushes any pending write for the same key before delegating.
 */

import type { StorageAdapter } from './adapter';

export interface CoalescingOptions {
  /** Coalesce window in ms. Default 200ms. */
  flushMs?: number;
  /**
   * Audit 2026-05-11 W2.1 (REL-004): per-key write-error surface.
   * Coalesced writes are best-effort by design, but previously ALL
   * errors were silently swallowed. This callback is invoked once
   * per failed flush so the host can log / throttle telemetry.
   */
  onWriteError?: (key: string, err: unknown) => void;
}

const PENDING_SENTINEL = Symbol('vs-coalescing-pending');

export function createCoalescingAdapter(
  inner: StorageAdapter,
  opts: CoalescingOptions = {},
): StorageAdapter {
  const flushMs = opts.flushMs ?? 200;
  const onWriteError = opts.onWriteError;
  const pending = new Map<string, unknown>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleFlush(): void {
    if (flushTimer !== null) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      const batch = Array.from(pending.entries());
      pending.clear();
      for (const [key, value] of batch) {
        // Fire writes in parallel; failures are independent. Surface
        // non-benign rejects via onWriteError.
        void inner.set(key, value).catch((err) => {
          if (onWriteError) {
            try {
              onWriteError(key, err);
            } catch {
              /* swallow — callback's own throw must not crash flush */
            }
          }
        });
      }
    }, flushMs);
  }

  return {
    async get<T>(key: string, defaultValue: T): Promise<T> {
      if (pending.has(key)) {
        const buffered = pending.get(key);
        if (buffered === PENDING_SENTINEL) return defaultValue; // queued remove
        return buffered as T;
      }
      return inner.get<T>(key, defaultValue);
    },

    async set(key: string, value: unknown): Promise<void> {
      pending.set(key, value);
      scheduleFlush();
    },

    async remove(key: string): Promise<void> {
      pending.set(key, PENDING_SENTINEL);
      // Flush immediately so the remove takes effect on the underlying
      // adapter without waiting for the coalesce window.
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      const batch = Array.from(pending.entries());
      pending.clear();
      const tasks = batch.map(([k, v]) => {
        if (v === PENDING_SENTINEL) return inner.remove(k);
        return inner.set(k, v);
      });
      await Promise.allSettled(tasks);
    },
  };
}
