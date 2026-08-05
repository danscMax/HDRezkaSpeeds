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
 * is well-separated.
 *
 * KNOWN DOS LIMITATION (audit 2026-05-11 W5.3 / V-F20): the marker
 * is `document.documentElement.dataset.vsTmActive` — a shared DOM
 * attribute that the host page can set at document_start (before our
 * content script runs at document_idle). A hostile host page can
 * suppress our injection by planting that marker, denying the user
 * the speed-control UI. This is FUNCTIONAL DENIAL ONLY — no data
 * exfiltration is possible through the marker. Mitigation requires
 * either (a) a cryptographic marker bound to a Symbol the host
 * cannot enumerate, or (b) document-level guarantees that the host
 * cannot reach. Neither is worth the complexity for a DoS-only
 * surface where the worst outcome is "extension feature unavailable
 * on this site". If a real user reports the extension dead on a
 * specific site, check whether the page sets vsTmActive — that's
 * the diagnostic signature.
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
/**
 * Is a legacy userscript artifact actually on screen?
 *
 * Exported for tests — the visibility rule is the whole point and it is worth
 * pinning. `getBoundingClientRect` rather than `offsetParent` because a
 * `position: fixed` control has no offsetParent yet is perfectly visible.
 */
export function hasVisibleArtifact(doc: Document): boolean {
  for (const el of doc.querySelectorAll(LEGACY_TM_DOM_SELECTORS)) {
    const rect = (el as HTMLElement).getBoundingClientRect?.();
    // No layout information at all (jsdom, detached node) → fall back to the
    // old "it exists" behaviour rather than inventing a verdict.
    if (!rect) return true;
    if (rect.width > 0 && rect.height > 0) return true;
  }
  return false;
}

export function detectAndClaim(): CoexistDecision {
  const root = document.documentElement;

  // (1) TM userscript announced itself via the agreed marker.
  if (root.dataset[TM_MARKER_KEY] === '1') {
    return { proceed: false, reason: 'tm-userscript-active' };
  }

  // (2) Older TM versions / forks don't set the marker but still leave
  //     recognizable DOM artifacts. Treat that as an active userscript — but
  //     only artifacts the user can actually SEE.
  //
  //     `.speed-button` / `#more-speeds-container` are generic enough to be
  //     collateral: a hidden leftover from our own failed teardown, or an
  //     unrelated script's element. HDRezka pages routinely run three or more
  //     competing userscripts at once, so a false positive here is not
  //     hypothetical — and its cost is the whole UI silently never appearing,
  //     with nothing on screen to explain it. A speed control nobody can see is
  //     not a speed control that conflicts with ours.
  if (hasVisibleArtifact(document)) {
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
