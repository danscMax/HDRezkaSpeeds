import { describe, expect, it, vi } from 'vitest';
import { CleanupRegistry } from '../../src/app/cleanup';

describe('CleanupRegistry', () => {
  describe('signal()', () => {
    it('returns a fresh AbortSignal each call', () => {
      const r = new CleanupRegistry();
      const a = r.signal();
      const b = r.signal();
      expect(a).not.toBe(b);
      expect(a.aborted).toBe(false);
      expect(b.aborted).toBe(false);
    });

    it('aborts all signals on dispose()', () => {
      const r = new CleanupRegistry();
      const a = r.signal();
      const b = r.signal();
      r.dispose();
      expect(a.aborted).toBe(true);
      expect(b.aborted).toBe(true);
    });

    it('throws after dispose()', () => {
      const r = new CleanupRegistry();
      r.dispose();
      expect(() => r.signal()).toThrowError(/after dispose/);
    });
  });

  describe('addEventListener()', () => {
    it('handler stops firing after dispose()', () => {
      const r = new CleanupRegistry();
      const target = new EventTarget();
      const handler = vi.fn();
      r.addEventListener(target, 'ping', handler);

      target.dispatchEvent(new Event('ping'));
      expect(handler).toHaveBeenCalledTimes(1);

      r.dispose();
      target.dispatchEvent(new Event('ping'));
      expect(handler).toHaveBeenCalledTimes(1); // still 1, not 2
    });

    it('respects opts.once when wrapped', () => {
      const r = new CleanupRegistry();
      const target = new EventTarget();
      const handler = vi.fn();
      r.addEventListener(target, 'ping', handler, { once: true });

      target.dispatchEvent(new Event('ping'));
      target.dispatchEvent(new Event('ping'));
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('setInterval() / setTimeout()', () => {
    it('clears intervals on dispose()', () => {
      vi.useFakeTimers();
      try {
        const r = new CleanupRegistry();
        const tick = vi.fn();
        r.setInterval(tick, 100);

        vi.advanceTimersByTime(350);
        expect(tick).toHaveBeenCalledTimes(3);

        r.dispose();
        vi.advanceTimersByTime(1_000);
        expect(tick).toHaveBeenCalledTimes(3); // no further ticks
      } finally {
        vi.useRealTimers();
      }
    });

    it('clears pending timeouts on dispose()', () => {
      vi.useFakeTimers();
      try {
        const r = new CleanupRegistry();
        const fn = vi.fn();
        r.setTimeout(fn, 500);

        r.dispose();
        vi.advanceTimersByTime(1_000);
        expect(fn).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('addObserver()', () => {
    it('disconnects observers on dispose()', () => {
      const r = new CleanupRegistry();
      const disconnect = vi.fn();
      r.addObserver({ disconnect });

      r.dispose();
      expect(disconnect).toHaveBeenCalledTimes(1);
    });

    it('returns the observer for fluent style', () => {
      const r = new CleanupRegistry();
      const o = { disconnect: () => {} };
      expect(r.addObserver(o)).toBe(o);
    });
  });

  describe('add()', () => {
    it('runs custom cleanup functions on dispose()', () => {
      const r = new CleanupRegistry();
      const fn = vi.fn();
      r.add(fn);
      r.dispose();
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('dispose()', () => {
    it('is idempotent (multiple calls are a no-op)', () => {
      const r = new CleanupRegistry();
      const fn = vi.fn();
      r.add(fn);

      r.dispose();
      r.dispose();
      r.dispose();
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('keeps tearing down even when one disposable throws', () => {
      const r = new CleanupRegistry();
      const ok = vi.fn();
      const explode = vi.fn(() => {
        throw new Error('boom');
      });
      r.add(explode);
      r.add(ok);
      r.add(() => {
        throw new Error('boom2');
      });

      // Must not propagate.
      expect(() => r.dispose()).not.toThrow();
      expect(ok).toHaveBeenCalled();
      expect(explode).toHaveBeenCalled();
    });

    it('flips isDisposed', () => {
      const r = new CleanupRegistry();
      expect(r.isDisposed).toBe(false);
      r.dispose();
      expect(r.isDisposed).toBe(true);
    });
  });

  describe('post-dispose guards', () => {
    it.each([
      [
        'addEventListener',
        (r: CleanupRegistry) => r.addEventListener(new EventTarget(), 'x', () => {}),
      ],
      ['setInterval', (r: CleanupRegistry) => r.setInterval(() => {}, 1000)],
      ['setTimeout', (r: CleanupRegistry) => r.setTimeout(() => {}, 1000)],
      ['addObserver', (r: CleanupRegistry) => r.addObserver({ disconnect: () => {} })],
      ['add', (r: CleanupRegistry) => r.add(() => {})],
    ])('%s throws after dispose()', (_name, fn) => {
      const r = new CleanupRegistry();
      r.dispose();
      expect(() => fn(r)).toThrowError(/after dispose/);
    });
  });
});
