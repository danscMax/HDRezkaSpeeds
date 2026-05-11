/**
 * Coalescing wrapper over a StorageAdapter.
 *
 * Why: a held hotkey (or any non-coalesced caller misbehaving) can
 * flood the underlying storage at 60–120+ writes/sec. Each write is a
 * separate IPC round-trip to the extension service worker plus a disk
 * flush; collapsing bursts into one write per coalesce window cuts
 * IPC + disk-IO cost by orders of magnitude.
 *
 * Audit 2026-05-11 W5.8 (PLAT-007): the earlier "120-writes-per-
 * minute Chrome quota" justification was wrong. That quota applies
 * to `chrome.storage.sync` only — `.local` (what we use) has only a
 * size cap. Coalescing is still valuable for IPC/disk amortization.
 *
 * This wrapper buffers writes per-key for `flushMs` (default 200ms) and
 * collapses bursts into a single underlying `set()`. Last write wins.
 * Reads are pass-through but check the pending buffer first so
 * `get(k)` immediately after `set(k, v)` returns `v` instead of the
 * pre-burst value.
 *
 * `remove()` drops any pending write for the same key and forwards
 * directly to inner.remove (W5.7).
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
      // Audit 2026-05-11 W5.7: pending only holds real values now
      // (remove() no longer queues a sentinel).
      if (pending.has(key)) return pending.get(key) as T;
      return inner.get<T>(key, defaultValue);
    },

    async set(key: string, value: unknown): Promise<void> {
      pending.set(key, value);
      scheduleFlush();
    },

    async remove(key: string): Promise<void> {
      // Audit 2026-05-11 W5.7 (PERF-012): drop the queued write for
      // this key (if any) and forward to inner.remove directly. The
      // previous code flushed ALL pending writes under one await —
      // turning unrelated fire-and-forget writes into blocking
      // writes whenever a remove overlapped them. The other pending
      // writes either fire on the next scheduled flush or after
      // this remove resolves; no behavior change for them.
      pending.delete(key);
      if (pending.size > 0 && flushTimer === null) {
        scheduleFlush();
      }
      await inner.remove(key);
    },
  };
}
