/**
 * Cleanup registry for the lifetime of one content-script (or popup) init.
 *
 * Every long-lived listener / timer / observer / arbitrary teardown handle
 * MUST be registered here. On dispose() everything is torn down in one shot,
 * which is what we run when:
 *   - WXT signals invalidation (extension reload, dev HMR)
 *   - TM coexistence detector flips post-init (defensive)
 *   - kill-switch trips
 *   - SPA navigation forces a hard rebuild
 *
 * Without this discipline we leak listeners on every reload, double-bind
 * keydown handlers, and the page slowly drowns in observer callbacks. The
 * audit (C3) calls this out explicitly.
 *
 * Idempotent: dispose() can be called many times, and adding to a disposed
 * registry throws so the bug shows up immediately instead of silently leaking.
 */

export type CleanupFn = () => void;

export class CleanupRegistry {
  private disposed = false;
  private aborters = new Set<AbortController>();
  private intervals = new Set<ReturnType<typeof setInterval>>();
  private timeouts = new Set<ReturnType<typeof setTimeout>>();
  private observers = new Set<{ disconnect(): void }>();
  private custom = new Set<CleanupFn>();

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Diagnostic snapshot of the registry size. Useful for spotting
   *  listener leaks (e.g. menu rerenders adding to `custom` without
   *  ever disposing). */
  get sizes(): {
    aborters: number;
    intervals: number;
    timeouts: number;
    observers: number;
    custom: number;
  } {
    return {
      aborters: this.aborters.size,
      intervals: this.intervals.size,
      timeouts: this.timeouts.size,
      observers: this.observers.size,
      custom: this.custom.size,
    };
  }

  /**
   * Returns a fresh AbortSignal scoped to this registry. The matching controller
   * is tracked, so dispose() aborts everything that consumed the signal.
   *
   * Typical use: `target.addEventListener(type, handler, { signal: ctx.cleanup.signal() })`
   * — but prefer the `addEventListener` helper below; it removes a step.
   */
  signal(): AbortSignal {
    this.assertLive('signal');
    const ac = new AbortController();
    this.aborters.add(ac);
    return ac.signal;
  }

  /**
   * Wraps EventTarget.addEventListener with auto-cleanup.
   *
   * Pass a `once`/`capture`/`passive` flag through `opts` if needed — they are
   * merged with the AbortSignal option below.
   *
   * Why both signal AND explicit removeEventListener: production browsers
   * (Chrome 120+, Firefox 138+) honor `{ signal }` in addEventListener and
   * remove the listener on abort. happy-dom 15.x (our test env) does NOT,
   * which silently leaks listeners across tests. The explicit
   * removeEventListener in the custom-cleanup branch guarantees cleanup
   * everywhere; the signal stays for any consumer that reads `aborted`.
   */
  addEventListener<T extends EventTarget>(
    target: T,
    type: string,
    handler: EventListenerOrEventListenerObject,
    opts?: AddEventListenerOptions,
  ): void {
    this.assertLive('addEventListener');
    const signal = this.signal();
    target.addEventListener(type, handler, { ...opts, signal });
    this.custom.add(() => {
      try {
        target.removeEventListener(type, handler, opts);
      } catch {
        /* swallow — target may have gone away (frame detach, etc.) */
      }
    });
  }

  setInterval(fn: () => void, ms: number): ReturnType<typeof setInterval> {
    this.assertLive('setInterval');
    const id = globalThis.setInterval(fn, ms);
    this.intervals.add(id);
    return id;
  }

  setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    this.assertLive('setTimeout');
    // Audit 2026-05-09 perf O17: remove the id from the tracking set
    // when the timer fires so a long-lived registry doesn't accumulate
    // dead ids forever (every reattach + every retry adds a few).
    let id!: ReturnType<typeof setTimeout>;
    id = globalThis.setTimeout(() => {
      this.timeouts.delete(id);
      try {
        fn();
      } catch (e) {
        // Mirror addEventListener: don't let a thrown handler poison
        // sibling timers or intervals registered later.
        console.warn('[cleanup] setTimeout handler threw:', e);
      }
    }, ms);
    this.timeouts.add(id);
    return id;
  }

  /**
   * Tracks any object with a `disconnect()` method — covers MutationObserver,
   * ResizeObserver, IntersectionObserver, PerformanceObserver, plus custom
   * observers we may write later.
   */
  addObserver<T extends { disconnect(): void }>(o: T): T {
    this.assertLive('addObserver');
    this.observers.add(o);
    return o;
  }

  /**
   * Register an arbitrary teardown callback. Use this only when none of the
   * typed helpers above fits — for example, removing an element you injected
   * into the DOM, or reverting a monkey-patched global.
   */
  add(fn: CleanupFn): void {
    this.assertLive('add');
    this.custom.add(fn);
  }

  /**
   * Tear down everything. Safe to call multiple times — second+ calls are
   * no-ops. One disposable throwing does NOT prevent the rest from running.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const ac of this.aborters) {
      try {
        ac.abort();
      } catch {
        /* swallow */
      }
    }
    for (const id of this.intervals) {
      try {
        clearInterval(id);
      } catch {
        /* swallow */
      }
    }
    for (const id of this.timeouts) {
      try {
        clearTimeout(id);
      } catch {
        /* swallow */
      }
    }
    for (const o of this.observers) {
      try {
        o.disconnect();
      } catch {
        /* swallow */
      }
    }
    for (const fn of this.custom) {
      try {
        fn();
      } catch {
        /* swallow */
      }
    }

    this.aborters.clear();
    this.intervals.clear();
    this.timeouts.clear();
    this.observers.clear();
    this.custom.clear();
  }

  private assertLive(method: string): void {
    if (this.disposed) {
      throw new Error(`CleanupRegistry: ${method}() called after dispose()`);
    }
  }
}
