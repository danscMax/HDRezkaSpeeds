/**
 * Speed buttons row -- a horizontal strip of buttons (e.g. 1x, 1.25x,
 * 1.5x, 2x, 2.5x, 3x) plus the active-state marker.
 *
 * Render is a pure function; it returns an HTMLElement the caller inserts
 * into the player. Click handlers are attached in Wave 1.8b -- this module
 * only emits structural markup + class toggles.
 */

import { h } from './dom-h';

export interface ButtonsRowOptions {
  /** Speeds to render as buttons; usually derived from per-site bounds. */
  speeds: readonly number[];
  /** Currently applied speed -- gets the `.speed-button.active` class. */
  current: number;
  /**
   * Optional `title` attribute applied to every speed button. Surfaces
   * the click semantics ("Click — temporary, double-click — save as
   * default") on hover so a user who didn't read the welcome page can
   * still discover the behaviour. Translated string is passed in by
   * the panel layer; we don't import the i18n module here to keep
   * buttons.ts framework-agnostic.
   */
  buttonTitle?: string;
}

const ROW_CLASS = 'speed-buttons-row';
const BTN_CLASS = 'speed-button';
const ACTIVE_CLASS = 'active';

export function renderButtonsRow(opts: ButtonsRowOptions): HTMLElement {
  return h(
    'div',
    { class: ROW_CLASS },
    ...opts.speeds.map((s) =>
      h(
        'button',
        {
          type: 'button',
          class: isSameSpeed(s, opts.current) ? `${BTN_CLASS} ${ACTIVE_CLASS}` : BTN_CLASS,
          'data-vs-speed': s,
          title: opts.buttonTitle,
        },
        formatSpeedLabel(s),
      ),
    ),
  );
}

/**
 * Toggle the `.active` class to whichever button matches `current`. No
 * re-render -- expects the row from `renderButtonsRow` is already in DOM.
 */
export function refreshActiveButton(row: Element, current: number): void {
  const buttons = row.querySelectorAll<HTMLButtonElement>(`.${BTN_CLASS}`);
  for (const btn of Array.from(buttons)) {
    const speedAttr = btn.getAttribute('data-vs-speed');
    const speed = speedAttr ? parseFloat(speedAttr) : NaN;
    btn.classList.toggle(ACTIVE_CLASS, isSameSpeed(speed, current));
  }
}

/**
 * Default preset speeds for each site (parity with original userscript
 * .user.js:4004-4008).
 *
 * - YouTube: 1.5–3.5 in 0.25 steps. Tuned for fast-forwarding lectures
 *   and reviews where the user already knows they want > 1×; the
 *   absence of 1× is intentional (clicking the active button toggles
 *   nothing useful, and YouTube's own UI exposes 1× via the speed menu).
 * - RuTube: 1–3 in 0.25 steps (full range, since RuTube's own player
 *   has no fine-grained speed control).
 */
export const DEFAULT_PRESETS: Readonly<Record<string, readonly number[]>> = {
  youtube: [1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5],
  rutube:  [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3],
};

function isSameSpeed(a: number, b: number): boolean {
  // Threshold 0.01 (parity with .user.js:2630 Math.abs < 0.01). Tighter
  // 0.001 used to miss button highlight after float-drift accumulation
  // (1.0 + 0.1 × 5 = 1.4999...x) — audit C2.3.
  return Math.abs(a - b) < 0.01;
}

/**
 * Render a speed value as a button label: integers get "2x", fractions
 * get the minimal decimal form ("1.5x", "1.25x"). Avoids visual noise
 * like "1.00x" or "1.50x" while keeping precision for the in-between values.
 */
function formatSpeedLabel(s: number): string {
  if (Number.isInteger(s)) return `${s}x`;
  return s.toFixed(2).replace(/0+$/, '').replace(/\.$/, '') + 'x';
}
