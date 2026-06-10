/**
 * Coalescing wrapper over a StorageAdapter.
 *
 * Why: a held hotkey (or any non-coalesced caller misbehaving) can
 * flood the underlying storage at 60–120+ writes/sec. Each write is a
 * separate IPC round-trip to the extension service worker plus a disk
 * flush; collapsing bursts into one write per coalesce window cuts
 * IPC + disk-IO cost by orders of magnitude on the slider-drag /
 * hotkey-repeat paths.
 *
 * Audit 2026-05-11 W5.8 (PLAT-007): the earlier "120-writes-per-
 * minute Chrome quota" justification was wrong. That quota
 * (MAX_WRITE_OPERATIONS_PER_MINUTE = 120) applies to
 * `chrome.storage.sync` ONLY. `chrome.storage.local` has only a size
 * cap (10 MB by default). Coalescing is still valuable for IPC/disk
 * amortization, but it isn't quota-protection.
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
   * Coalesced writes are best-effort by design (quota-exceeded during
   * a slider drag isn't worth retrying), but previously ALL errors
   * were silently swallowed — speedStore reported success while
   * disk diverged. This callback is invoked once per failed flush so
   * the host can log/throttle telemetry. Default no-op preserves
   * existing behavior for callers that don't opt in.
   */
  onWriteError?: (key: string, err: unknown) => void;
}

export interface CoalescingAdapter extends StorageAdapter {
  /**
   * Flush every buffered write immediately, bypassing the coalesce
   * window. Wired to `pagehide` by the host: without it a write that
   * lands <flushMs before navigation (e.g. double-click "save as
   * default" followed by an instant reload) silently evaporates.
   */
  flushNow(): Promise<void>;
}

export function createCoalescingAdapter(
  inner: StorageAdapter,
  opts: CoalescingOptions = {},
): CoalescingAdapter {
  const flushMs = opts.flushMs ?? 200;
  const onWriteError = opts.onWriteError;
  const pending = new Map<string, unknown>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  function flushBatch(): Promise<void> {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    const batch = Array.from(pending.entries());
    pending.clear();
    const writes = batch.map(([key, value]) =>
      // Fire writes in parallel; failures are independent. Each
      // adapter.set already swallows context-invalidated and other
      // benign cases. Surface non-benign rejects via onWriteError
      // so callers can log / increment HealthChecker counters.
      inner.set(key, value).catch((err) => {
        if (onWriteError) {
          try {
            onWriteError(key, err);
          } catch {
            /* swallow — callback's own throw must not crash flush */
          }
        }
      }),
    );
    return Promise.all(writes).then(() => undefined);
  }

  function scheduleFlush(): void {
    if (flushTimer !== null) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushBatch();
    }, flushMs);
  }

  return {
    flushNow(): Promise<void> {
      return flushBatch();
    },
    async get<T>(key: string, defaultValue: T): Promise<T> {
      // Audit 2026-05-11 W5.7: pending no longer holds PENDING_SENTINEL
      // (remove() no longer queues). A pending entry is always a real
      // value waiting to flush.
      if (pending.has(key)) return pending.get(key) as T;
      return inner.get<T>(key, defaultValue);
    },

    async set(key: string, value: unknown): Promise<void> {
      pending.set(key, value);
      scheduleFlush();
    },

    async remove(key: string): Promise<void> {
      // Audit 2026-05-11 W5.7 (PERF-012): drop the queued write for
      // this key (if any) and forward to inner.remove(key) directly.
      // The previous implementation flushed ALL pending writes under
      // one await — turning a fire-and-forget speedStore write into
      // a blocking write whenever a remove happened to overlap. The
      // other pending writes either fire on the next scheduled flush
      // (no behavior change) or after this remove resolves.
      pending.delete(key);
      // Keep the existing flush timer running if other keys are still
      // pending; only schedule one if remove leaves writes orphaned.
      if (pending.size > 0 && flushTimer === null) {
        scheduleFlush();
      }
      await inner.remove(key);
    },
  };
}
