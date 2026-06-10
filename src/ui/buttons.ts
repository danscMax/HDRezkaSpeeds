/**
 * Speed buttons row -- a horizontal strip of buttons (e.g. 1x, 1.25x,
 * 1.5x, 2x, 2.5x, 3x) plus the active-state marker.
 *
 * Render is a pure function; it returns an HTMLElement the caller inserts
 * into the player. Click handlers are attached in Wave 1.8b -- this module
 * only emits structural markup + class toggles.
 */

import { h } from './dom-h';
// formatSpeedLabel uses the shared formatter (audit 2026-05-09 Q6).
import { formatSpeed as formatSpeedLabel } from './format';

export interface ButtonsRowOptions {
  /** Speeds to render as buttons; usually derived from per-site bounds. */
  speeds: readonly number[];
  /** Currently applied speed -- gets the `.speed-button.active` class. */
  current: number;
  /**
   * Saved/default speed (the value persisted via setCurrent + rememberSpeed
   * = true). Gets the `.speed-button.pinned` class — visually decorated
   * with a small dot in the corner. `null` means no pin (rememberSpeed
   * off, or stored speed not in the visible preset row).
   */
  pinned?: number | null;
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
const PINNED_CLASS = 'pinned';

function classFor(s: number, current: number, pinned: number | null | undefined): string {
  const cls = [BTN_CLASS];
  if (isSameSpeed(s, current)) cls.push(ACTIVE_CLASS);
  if (pinned != null && isSameSpeed(s, pinned)) cls.push(PINNED_CLASS);
  return cls.join(' ');
}

export function renderButtonsRow(opts: ButtonsRowOptions): HTMLElement {
  return h(
    'div',
    { class: ROW_CLASS },
    ...opts.speeds.map((s) =>
      h(
        'button',
        {
          type: 'button',
          class: classFor(s, opts.current, opts.pinned ?? null),
          'data-vs-speed': s,
          title: opts.buttonTitle,
        },
        formatSpeedLabel(s),
      ),
    ),
  );
}

// Audit 2026-05-11 W6.5 (PERF-010): cache the previously-active /
// previously-pinned values on the row element itself so a no-op
// refresh (which happens on every ratechange — HLS quality switches,
// self-write echoes) short-circuits before any DOM mutation. The
// classes are toggled by walking the row's direct children once
// instead of a fresh querySelectorAll per call — modal-open settings
// rerenders, ratechange events, and refreshButtons all hit this.
type RowState = Element & {
  __vsLastCurrent?: number;
  __vsLastPinned?: number | null;
};

/**
 * Toggle the `.active` class to whichever button matches `current`. No
 * re-render -- expects the row from `renderButtonsRow` is already in DOM.
 */
export function refreshActiveButton(row: Element, current: number): void {
  const rowState = row as RowState;
  if (rowState.__vsLastCurrent !== undefined && isSameSpeed(rowState.__vsLastCurrent, current)) {
    return;
  }
  rowState.__vsLastCurrent = current;
  // Walk direct children (not querySelectorAll over the whole subtree).
  for (const child of Array.from(row.children)) {
    if (!child.classList.contains(BTN_CLASS)) continue;
    const speedAttr = child.getAttribute('data-vs-speed');
    const speed = speedAttr ? parseFloat(speedAttr) : NaN;
    child.classList.toggle(ACTIVE_CLASS, isSameSpeed(speed, current));
  }
}

/**
 * Toggle the `.pinned` class to the button matching `pinned`. Pass
 * `null` to clear all pin markers (e.g. rememberSpeed got turned off).
 */
export function refreshPinnedButton(row: Element, pinned: number | null): void {
  const rowState = row as RowState;
  const prev = rowState.__vsLastPinned;
  if (prev !== undefined) {
    // No-change short-circuit covers both null↔null and same-value cases.
    if (prev === null && pinned === null) return;
    if (prev !== null && pinned !== null && isSameSpeed(prev, pinned)) return;
  }
  rowState.__vsLastPinned = pinned;
  for (const child of Array.from(row.children)) {
    if (!child.classList.contains(BTN_CLASS)) continue;
    const speedAttr = child.getAttribute('data-vs-speed');
    const speed = speedAttr ? parseFloat(speedAttr) : NaN;
    child.classList.toggle(PINNED_CLASS, pinned != null && isSameSpeed(speed, pinned));
  }
}

function isSameSpeed(a: number, b: number): boolean {
  // Threshold 0.01 (parity with .user.js:2630 Math.abs < 0.01). Tighter
  // 0.001 used to miss button highlight after float-drift accumulation
  // (1.0 + 0.1 × 5 = 1.4999...x) — audit C2.3.
  return Math.abs(a - b) < 0.01;
}
