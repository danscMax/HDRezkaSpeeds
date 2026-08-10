/**
 * HDRezka CSS selector tables.
 *
 * Ordered: most-specific / most-stable first; fallbacks last. The engine's
 * "exact" strategy walks the array in order. Substring fragments are used
 * by the "substring" strategy as a hashed-CSS-Modules-resistant retry.
 *
 * Ported from the userscript reference (.user.js:918-936 + 1250-1253):
 *   - Plyr is the embedded player; controls live under .plyr__controls
 *   - The b-player wrapper holds the iframe / native video on movie pages
 *   - Series episode lists and post info live under b-content__* classes
 */

import type { Site } from '../app/ports';
import type { SelectorKey } from './types';

export type SelectorMap = Partial<Record<SelectorKey, readonly string[]>>;

const SELECTORS: Record<Site, SelectorMap> = {
  hdrezka: {
    infoElem: [
      '.b-content__inline_items', // Series — episode list
      '.b-post__info', // Movie — info block
      '.b-post__description', // Description
      '.b-content__main', // Main content fallback
    ],
    video: ['#oframecdnplayer video', '.b-player video', 'video'],
    playerContainer: ['.b-player', '#player', '#oframecdnplayer', '.b-content__main .player'],
    controlsContainer: ['.plyr__controls', '.pjsdiv', '.player-controls'],
    leftControls: ['.plyr__controls__item--left'],
    rightControls: ['.plyr__controls__item--right'],
  },
};

/**
 * Can this site host the slider inside the player's own control bar
 * (`sliderPosition: 'video'`)? True when there is somewhere to mount it —
 * which is exactly what panel.applyLayout() looks up before it moves the
 * slider, so the settings menu and the layout agree by construction.
 *
 * Always true here (one site, and it has a control bar); it exists so the
 * twins keep one shared shape. In VideoSpeeds this replaced a literal
 * `site === 'youtube'` that hid the option on RuTube even though its
 * control-bar selectors had been in the table all along.
 */
export function supportsInPlayerSlider(site: Site): boolean {
  const map = SELECTORS[site];
  return (map.rightControls?.length ?? 0) > 0 || (map.controlsContainer?.length ?? 0) > 0;
}

export function selectorsFor(site: Site): SelectorMap {
  return SELECTORS[site];
}

/**
 * Substring fragments used by the "substring" strategy. Pulls stable
 * fragments out of the canonical class names so the resolver can recover
 * if HDRezka renames the surrounding class.
 */
const SUBSTRING_FRAGMENTS: Record<Site, Partial<Record<SelectorKey, readonly string[]>>> = {
  hdrezka: {
    playerContainer: ['b-player', 'oframecdnplayer'],
    infoElem: ['b-content__inline_items', 'b-post__info'],
  },
};

export function substringFragmentsFor(site: Site, key: SelectorKey): readonly string[] {
  return SUBSTRING_FRAGMENTS[site]?.[key] ?? [];
}
