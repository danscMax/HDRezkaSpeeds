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

export function detectFeatures(): FeatureFlags {
  const win = typeof window !== 'undefined' ? window : ({} as Window);

  return {
    navigationApi:
      typeof win === 'object' &&
      'navigation' in win &&
      (win as unknown as { navigation: unknown }).navigation !== null &&
      typeof (win as unknown as { navigation: { addEventListener?: unknown } }).navigation
        .addEventListener === 'function',

    trustedTypes:
      typeof win === 'object' &&
      'trustedTypes' in win &&
      typeof (win as unknown as { trustedTypes: { createPolicy?: unknown } }).trustedTypes
        ?.createPolicy === 'function',

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
