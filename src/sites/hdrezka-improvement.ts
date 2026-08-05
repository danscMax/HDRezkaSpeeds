/**
 * Soft-detect the popular HDrezka-Improvement userscript.
 *
 * Lives in src/sites/ rather than in src/utils/tm-coexist.ts because it is
 * knowledge about ONE site: the twin (YouTube/RuTube) can never meet this
 * script, and src/utils is shared code kept byte-identical between the two
 * extensions. Sitting there, it was dead weight in the twin — an unused
 * function logging `[HDREZKA-SPEEDS]` inside VideoSpeeds.
 *
 * Unlike the TM-userscript coexistence check, this does NOT block our
 * bootstrap — the two scripts touch different things (HC-Improvement is
 * layout/theme tweaks, we are speed control). They CAN overlap on the player
 * area though, so the finding is surfaced rather than swallowed.
 *
 * Probes (in order):
 *   1. window.HDrezkaImprovement (or window.hcImprovement) is truthy.
 *   2. Any element on the page carries an `id="hc-..."` or
 *      `class="...hc-..."` token — HC-Improvement applies that prefix
 *      to its toggle classes (hc-content-size-..., hc-style-..., etc.,
 *      seen in the HDRezka console output the user shared 2026-05-06).
 */
export function warnIfHdrezkaImprovementPresent(): boolean {
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
    if (!flagSet && !domMatch) return false;
    console.warn(
      '[HDREZKA-SPEEDS] HDrezka-Improvement userscript detected — speed controls may overlap with that script. If something looks broken, disable one of them.',
    );
    // Returned, not just logged: the two scripts CAN overlap on the player
    // area, and a console line is invisible to the person actually looking at
    // the overlap. The caller decides how to say it out loud.
    return true;
  } catch {
    /* swallow — diagnostic-only */
    return false;
  }
}
