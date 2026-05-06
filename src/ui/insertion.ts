/**
 * Decide WHERE the panel lands in the page DOM.
 *
 * The `sliderPosition` setting picks one of three behaviors:
 *   - 'right'   -> insert as a SIBLING right after the player container.
 *   - 'bottom'  -> same anchor as 'right' for now; CSS controls the
 *                  internal layout (slider beside vs below the buttons).
 *   - 'video'   -> embed into the player chrome's bottom controls bar
 *                  (Plyr controls). Overlay style.
 *
 * For HDRezka the userscript reference inserts the panel STRICTLY after the
 * .b-player wrapper. We follow the same approach: find the player wrapper,
 * insert as its next sibling.
 */

import type { AppContext } from '../app/context';
import type { SliderPosition } from '../storage/types';

export type InsertionAnchor =
  | 'before-info'    // sibling of infoElem
  | 'after-player'   // sibling right after player container (preferred for HDRezka)
  | 'video-overlay'  // inside player chrome ('video' position only)
  | 'no-anchor';     // could not find a valid spot; defer

export interface InsertionResult {
  parent: Element | null;
  anchor: InsertionAnchor;
  tentative?: boolean;
}

export function insertPanel(panel: HTMLElement, ctx: AppContext): InsertionResult {
  const pos: SliderPosition = ctx.settingsStore.getKey('sliderPosition');
  const choice = chooseAnchor(pos, ctx);

  if (choice.parent) {
    const alreadyThere = panel.parentElement === choice.parent &&
      (choice.before == null || panel.nextSibling === choice.before);
    if (!alreadyThere) {
      try { panel.parentElement?.removeChild(panel); } catch { /* moved by host */ }

      try {
        if (choice.before && choice.parent.contains(choice.before)) {
          choice.parent.insertBefore(panel, choice.before);
        } else {
          choice.parent.appendChild(panel);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[HDREZKA-SPEEDS] panel insertion failed:', e);
        return { parent: null, anchor: 'no-anchor' };
      }
    }
  } else {
    try { panel.parentElement?.removeChild(panel); } catch { /* swallow */ }
  }

  return { parent: choice.parent, anchor: choice.anchor, tentative: choice.tentative };
}

interface AnchorChoice {
  parent: Element | null;
  anchor: InsertionAnchor;
  before?: Node | null;
  tentative?: boolean;
}

function chooseAnchor(pos: SliderPosition, ctx: AppContext): AnchorChoice {
  void pos; // applyLayout owns slider migration; main panel uses one anchor.

  // 1. Preferred for HDRezka: insert as the next sibling of the player
  //    wrapper (.b-player / #oframecdnplayer / etc.). The userscript
  //    reference does the same — strictly AFTER the player.
  const player = ctx.discovery.resolve('playerContainer');
  if (player?.parentElement) {
    return {
      parent: player.parentElement,
      anchor: 'after-player',
      before: skipOwnPanel(player.nextSibling),
    };
  }

  // 2. Fallback: before the info block (episode list / movie info), if
  //    the player container hasn't been resolved yet. Tentative — we'd
  //    much rather sit next to the player.
  const info = ctx.discovery.resolve('infoElem');
  if (info?.parentElement) {
    return {
      parent: info.parentElement,
      anchor: 'before-info',
      before: info,
      tentative: true,
    };
  }

  // 3. No anchor — defer.
  return { parent: null, anchor: 'no-anchor' };
}

/**
 * Walk past our own panel(s) when computing a `before`-reference.
 */
function skipOwnPanel(node: Node | null): Node | null {
  let cur = node;
  while (cur && cur instanceof Element && cur.classList.contains('vs-panel')) {
    cur = cur.nextSibling;
  }
  return cur;
}

export function detachPanel(panel: HTMLElement): void {
  panel.parentElement?.removeChild(panel);
}
