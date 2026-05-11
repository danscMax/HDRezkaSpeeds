/**
 * Acceptance criteria per selector key. Used by DiscoveryEngine to reject
 * accidental matches (e.g. heuristic strategy finding a thumbnail
 * instead of the real player). Each validator returns `{ok, reasons}`;
 * reasons feed into the diagnostic report.
 *
 * HDRezka context: this is a classic multi-page site, not a SPA. Plyr
 * mounts the <video> lazily after the user clicks the play overlay, so
 * we can't require currentSrc/readyState — the validator only filters
 * thumbnail-sized previews and autoplay decoys. The LCA-distance check
 * on infoElem keeps a generous threshold because HD's metadata anchors
 * (.b-content__inline_items, .b-post__info) sit in the body trunk
 * rather than under the player wrapper. Audit 2026-05-11 W3.4 (V-F17,
 * V-F18): file used to inherit verbatim from VS — comments rewritten
 * to reflect HD reality, threshold raised from 10 to 15.
 */

import type { SelectorKey, ValidationResult, Validator } from './types';

// Audit 2026-05-09 sec C11: return a fresh result on every call. The
// previous singleton `const ok = { ok: true, reasons: [] }` was returned
// to all callers; if any consumer pushed a reason into `result.reasons`
// (a reasonable thing to do given the type), it corrupted the global
// success constant for every subsequent validation in the program's
// lifetime.
function ok(): ValidationResult {
  return { ok: true, reasons: [] };
}
function fail(reason: string): ValidationResult {
  return { ok: false, reasons: [reason] };
}

function isElement(el: unknown): el is Element {
  return !!el && typeof (el as Element).isConnected === 'boolean';
}

/**
 * Distance from `a` to `b` through their lowest common ancestor. Returns
 * Infinity if the two nodes don't share a common ancestor in `document`.
 *
 * Audit 2026-05-09 perf O7: O(d) via Map<Element,depth> — the previous
 * O(d²) `ancA.indexOf(n)` inside the b-walk loop is significant on
 * YouTube where DOM depth runs 15-20 levels.
 */
function lcaDistance(a: Element, b: Element): number {
  const ancADepth = new Map<Element, number>();
  let i = 0;
  for (let n: Element | null = a; n; n = n.parentElement) {
    ancADepth.set(n, i++);
  }
  let depth = 0;
  for (let n: Element | null = b; n; n = n.parentElement) {
    const idx = ancADepth.get(n);
    if (idx !== undefined) return idx + depth;
    depth++;
  }
  return Infinity;
}

const validators: Record<SelectorKey, Validator> = {
  video(el) {
    if (!isElement(el) || el.tagName !== 'VIDEO') return fail('not <video>');
    const v = el as HTMLVideoElement;
    const r = v.getBoundingClientRect();
    // Don't require currentSrc/readyState — on HDRezka the Plyr-wrapped
    // <video> is in the DOM before src is set (poster image + click-to-
    // play wrapper). The validator only filters thumbnails and autoplay
    // previews; the attachToVideo retry loop in src/index.ts handles
    // the "not ready" case.
    const hasSrc = !!v.currentSrc || !!v.src;
    if (hasSrc && r.width < 100 && r.height < 60) return fail('thumbnail-sized video');
    if (hasSrc && v.muted && v.loop && r.width < 400) return fail('autoplay preview');
    return ok();
  },

  playerContainer(el) {
    if (!isElement(el)) return fail('not Element');
    if (!el.isConnected) return fail('detached');
    if (!el.querySelector('video')) return fail('no <video> descendant');
    const r = el.getBoundingClientRect();
    if (r.width < 150 || r.height < 80) return fail('too small for real player');
    return ok();
  },

  infoElem(el) {
    if (!isElement(el)) return fail('not Element');
    if (!el.isConnected) return fail('detached');
    // clientHeight check from the userscript was filtering out empty
    // elements, but the metadata anchors (.b-content__inline_items,
    // .b-post__info) can have clientHeight=0 briefly during the post-
    // navigation reflow on episode change. Use childElementCount as a
    // lighter signal: anything with at least one child element is
    // "real enough" to be a metadata anchor; the LCA distance check
    // below filters out unrelated DOM islands.
    if (el.childElementCount === 0) return fail('empty -- nothing inside');
    const video = document.querySelector('video');
    // Threshold raised from 10 → 15 (audit 2026-05-11 W3.4 V-F18):
    // HD's metadata anchors live in the body trunk rather than under
    // the player wrapper, so a healthy LCA can be 8-12 hops on the
    // `.b-content__main` page layout. 10 was YouTube-tuned and
    // silently rejected valid HD candidates.
    if (video && lcaDistance(el, video) > 15) return fail('too far from video in DOM');
    return ok();
  },

  leftControls(el) {
    if (!isElement(el)) return fail('not Element');
    if (!el.isConnected) return fail('detached');
    if (!el.querySelector('button, [role="button"], svg, [class*="Button"]')) {
      return fail('no interactive controls inside');
    }
    return ok();
  },

  rightControls(el) {
    if (!isElement(el)) return fail('not Element');
    if (!el.isConnected) return fail('detached');
    if (!el.querySelector('button, [role="button"], svg, [class*="Button"]')) {
      return fail('no interactive controls inside');
    }
    return ok();
  },

  controlsContainer(el) {
    if (!isElement(el)) return fail('not Element');
    if (!el.isConnected) return fail('detached');
    if ((el as HTMLElement).clientWidth < 200) return fail('too narrow for controls bar');
    return ok();
  },
};

export const Validators = validators;
