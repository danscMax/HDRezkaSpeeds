/**
 * Tampermonkey + extension coexistence handshake (audit C3, H8).
 *
 * Two pieces of code want to inject the same speed-controls UI:
 *   1. The legacy Tampermonkey userscript (YouTube & HDRezka Speeds.user.js)
 *   2. This extension
 *
 * If both run on the same page we get duplicate buttons, double-bound
 * keydown handlers, and competing ratechange listeners. The fix is a
 * cooperative DOM-marker handshake on documentElement.dataset:
 *
 *   - TM userscript sets `data-vs-tm-active="1"` before injecting its UI.
 *     (Synchronized in a sister commit to the userscript repo, Wave 1.10.)
 *   - Extension sets `data-vs-ext-active="1"` before injecting its UI.
 *
 * Each side checks the other's marker first and exits early if it loses
 * the race. The extension also probes for legacy DOM artifacts
 * (`.speed-button`, `#more-speeds-container`) so old userscript versions
 * that don't yet set the marker still get detected.
 *
 * Limitations: this is best-effort. A true atomic claim is impossible
 * in the page's single-threaded model. Two scripts that initialize at
 * the exact same tick can both pass the check; in practice the userscript
 * runs at document_start and the extension at document_idle, so the order
 * is well-separated. Wave 1.10 may add a microtask re-check if real
 * collisions show up.
 */

const TM_MARKER_KEY = 'vsTmActive';
const EXT_MARKER_KEY = 'vsExtActive';

// kebab-case forms used in DOM probes / for documentation references.
export const TM_MARKER_ATTR = 'data-vs-tm-active';
export const EXT_MARKER_ATTR = 'data-vs-ext-active';

// CSS selectors for legacy userscript UI artifacts. Used as a fallback when
// the marker isn't set (older userscript versions, third-party speed scripts).
const LEGACY_TM_DOM_SELECTORS = ['.speed-button', '#more-speeds-container'].join(', ');

export type CoexistReason = 'tm-userscript-active' | 'extension-already-injected';

export interface CoexistDecision {
  proceed: boolean;
  reason?: CoexistReason;
}

/**
 * Atomically check-and-claim the extension marker.
 *
 * Returns `{ proceed: true }` if no conflict was detected and the marker is
 * now ours. Returns `{ proceed: false, reason }` otherwise.
 *
 * Call this exactly once per content-script load, as the first thing in
 * `bootstrap(ctx)`. If `proceed` is false, do NOT inject UI; show a one-time
 * notification (Wave 1.3 i18n keys `tm.detected.title` / `tm.detected.body`).
 */
export function detectAndClaim(): CoexistDecision {
  const root = document.documentElement;

  // (1) TM userscript announced itself via the agreed marker.
  if (root.dataset[TM_MARKER_KEY] === '1') {
    return { proceed: false, reason: 'tm-userscript-active' };
  }

  // (2) Older TM versions / forks don't set the marker but still leave
  //     recognizable DOM artifacts. Treat that as an active userscript.
  if (document.querySelector(LEGACY_TM_DOM_SELECTORS)) {
    return { proceed: false, reason: 'tm-userscript-active' };
  }

  // (3) Another extension instance already claimed (HMR reload, multi-frame).
  if (root.dataset[EXT_MARKER_KEY] === '1') {
    return { proceed: false, reason: 'extension-already-injected' };
  }

  // No conflict — claim and proceed.
  root.dataset[EXT_MARKER_KEY] = '1';
  return { proceed: true };
}

/**
 * Release the extension marker. Call from CleanupRegistry on dispose so a
 * subsequent injection (HMR) can claim again without an "already-injected"
 * false positive.
 */
export function release(): void {
  delete document.documentElement.dataset[EXT_MARKER_KEY];
}

/**
 * Test helper: clear all coexistence markers and any legacy DOM artifacts
 * we probe for. Not exported from index — only spec files import this.
 */
export function __resetForTests(): void {
  delete document.documentElement.dataset[TM_MARKER_KEY];
  delete document.documentElement.dataset[EXT_MARKER_KEY];
  for (const el of document.querySelectorAll(LEGACY_TM_DOM_SELECTORS)) el.remove();
}

/**
 * Soft-detect the popular HDrezka-Improvement userscript and emit a
 * one-line console warning if it is present. Unlike the TM-userscript
 * coexistence above, we do NOT block our bootstrap — the two scripts
 * touch different things (HC-Improvement is layout/theme tweaks,
 * we are speed control). They CAN overlap on the player area though,
 * and a heads-up in DevTools makes triage faster when a user reports
 * weirdness.
 *
 * Probes (in order):
 *   1. window.HDrezkaImprovement (or window.hcImprovement) is truthy.
 *   2. Any element on the page carries an `id="hc-..."` or
 *      `class="...hc-..."` token — HC-Improvement applies that prefix
 *      to its toggle classes (hc-content-size-..., hc-style-..., etc.,
 *      seen in the HDRezka console output the user shared 2026-05-06).
 */
export function warnIfHdrezkaImprovementPresent(): void {
  try {
    const w = window as unknown as {
      HDrezkaImprovement?: unknown;
      hcImprovement?: unknown;
    };
    const flagSet = !!(w.HDrezkaImprovement || w.hcImprovement);
    // Token-boundary class selectors only — `[class*="hc-"]` would match
    // `bg-hc-banner`, `theme-hc-mode`, third-party ad classes, etc., and
    // emit a false-positive warning for users without HC-Improvement.
    // Match `hc-` only at the start of an id, or at the start of a
    // class token (whitespace-separated).
    const domMatch = !!document.querySelector('[id^="hc-"], [class^="hc-"], [class*=" hc-"]');
    if (!flagSet && !domMatch) return;
    console.warn(
      '[HDREZKA-SPEEDS] HDrezka-Improvement userscript detected — speed controls may overlap with that script. If something looks broken, disable one of them.',
    );
  } catch {
    /* swallow — diagnostic-only */
  }
}
