/**
 * Lightweight runtime probe for browser capabilities we adapt to.
 *
 * Expanded from the userscript version (.user.js:166-188) by dropping all
 * `unsafeWindow` / `GM_*` checks -- inside a content script those don't
 * exist by definition.
 */

export interface FeatureFlags {
  /** Modern Navigation API (Chrome 102+, partial Firefox). */
  navigationApi: boolean;
  /** Trusted Types policy creation works (Chrome strict CSP sites). */
  trustedTypes: boolean;
  /** AbortSignal honored by EventTarget.addEventListener (true everywhere
   *  modern, but happy-dom < 16 is buggy -- see CleanupRegistry comments). */
  abortSignalListener: boolean;
}

// Memoized — feature detection is invariant within a content-script lifetime
// (the page can't gain or lose a Navigation API mid-session). Avoids repeated
// EventTarget+AbortController allocations on every call.
let _cached: FeatureFlags | null = null;

export function detectFeatures(): FeatureFlags {
  return (_cached ??= computeFeatures());
}

function computeFeatures(): FeatureFlags {
  const win = typeof window !== 'undefined' ? window : ({} as Window);

  return {
    // Audit 2026-05-09 sec C19: `'navigation' in win` is true even when
    // `win.navigation === undefined` on some engines, and `undefined.addEventListener`
    // throws TypeError synchronously. Wrap every property access in try/catch
    // so an exotic browser (or a page that polyfilled `navigation` to a
    // throwing getter) can't crash the whole feature-detect call.
    navigationApi: (() => {
      try {
        if (typeof win !== 'object') return false;
        if (!('navigation' in win)) return false;
        const nav = (win as unknown as { navigation: unknown }).navigation;
        if (nav === null || nav === undefined) return false;
        return (
          typeof (nav as { addEventListener?: unknown }).addEventListener === 'function'
        );
      } catch {
        return false;
      }
    })(),

    trustedTypes: (() => {
      try {
        if (typeof win !== 'object') return false;
        if (!('trustedTypes' in win)) return false;
        const tt = (win as unknown as { trustedTypes?: { createPolicy?: unknown } }).trustedTypes;
        return typeof tt?.createPolicy === 'function';
      } catch {
        return false;
      }
    })(),

    // Cheap probe: addEventListener accepts the option without throwing.
    // Doesn't catch the happy-dom case where it accepts but ignores.
    abortSignalListener: (() => {
      try {
        const target = new EventTarget();
        const ac = new AbortController();
        target.addEventListener('vs-feat-probe', () => {}, { signal: ac.signal });
        ac.abort();
        return true;
      } catch {
        return false;
      }
    })(),
  };
}
