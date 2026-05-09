/**
 * Acceptance criteria per selector key. Used by DiscoveryEngine to reject
 * accidental matches (e.g. heuristic strategy finding a sidebar thumbnail
 * instead of the real player). Each validator returns `{ok, reasons}`;
 * reasons feed into the diagnostic report.
 *
 * Ported from .user.js:980-1061 with HDRezka-specific paths dropped
 * (out of product scope). Otherwise behaviorally identical.
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
    // Don't require currentSrc/readyState — on YouTube SPA the <video> is
    // in the DOM before src is set. The validator only filters thumbnails
    // and autoplay previews; setSpeed has its own retry for "not ready".
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
    // elements, but on SPA navigations the watch-metadata container
    // often has clientHeight=0 for the first ~200ms while YouTube
    // hydrates its content. Use childElementCount as a lighter signal:
    // anything with at least one child element is "real enough" to be
    // a metadata anchor; the LCA distance check below filters out
    // sidebar candidates.
    if (el.childElementCount === 0) return fail('empty -- nothing inside');
    const video = document.querySelector('video');
    if (video && lcaDistance(el, video) > 10) return fail('too far from video in DOM');
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
