/**
 * Speed slider -- a single range input + numeric label, with a coloured
 * fill that tracks the value. Renders a fragment; click handlers attach
 * in Wave 1.8b.
 *
 * The slider's "fill" is implemented as a CSS gradient on the track,
 * recomputed whenever the value changes (`updateSliderFill`). The original
 * userscript does the same in .user.js:2630-2645.
 */

import { h } from './dom-h';

const CONTAINER_CLASS = 'speed-slider-container';
const INPUT_CLASS = 'speed-slider';
const LABEL_CLASS = 'speed-slider-label';
const VALUE_CLASS = 'speed-value';

export interface SliderOptions {
  current: number;
  min: number;
  max: number;
  step?: number;
}

/**
 * Slider DOM (Wave V parity with .user.js:4794-4852):
 *   .speed-slider-label  — always-visible left-of-slider label, only shown
 *                          in `video` chrome layout. Hidden by CSS in
 *                          panel layouts.
 *   .speed-slider        — the actual `<input type=range>`.
 *   .speed-value         — floating tooltip above the thumb, opacity 0
 *                          by default, opacity 1 on container :hover or
 *                          while the thumb is :active. Slides horizontally
 *                          via `style.left = N%` set in updateSliderFill.
 *                          Hidden in `video` chrome layout (the static
 *                          left label takes its place there).
 */
export function renderSlider(opts: SliderOptions): HTMLElement {
  const step = opts.step ?? 0.05;
  const speedText = formatSliderLabel(opts.current);
  const container = h(
    'div',
    { class: CONTAINER_CLASS },
    h('span', { class: LABEL_CLASS }, speedText),
    h('input', {
      type: 'range',
      class: INPUT_CLASS,
      min: opts.min,
      max: opts.max,
      step,
      value: opts.current,
    }),
    // role=status + aria-live=polite makes screen readers announce the new
    // value when it changes via hotkey or a preset button click. The native
    // <input type=range> only announces while focused; the live region
    // covers non-focus paths.
    h(
      'span',
      {
        class: VALUE_CLASS,
        role: 'status',
        'aria-live': 'polite',
        'aria-atomic': 'true',
      },
      speedText,
    ),
  );
  // Initial paint of the gradient fill + floating tooltip position.
  const input = container.querySelector<HTMLInputElement>(`.${INPUT_CLASS}`);
  if (input) updateSliderFill(input);
  return container;
}

/**
 * Update the gradient fill, the static label, and the floating tooltip
 * (text + horizontal position) to match the slider's current value.
 * Idempotent; safe to call from input/change handlers.
 */
export function updateSliderFill(input: HTMLInputElement): void {
  const min = parseFloat(input.min) || 0;
  const max = parseFloat(input.max) || 1;
  const value = parseFloat(input.value) || min;
  const percent = ((value - min) / (max - min)) * 100;
  input.style.setProperty('--vs-slider-fill', `${percent.toFixed(2)}%`);

  const container = input.closest(`.${CONTAINER_CLASS}`);
  if (!container) return;
  const text = formatSliderLabel(value);
  const label = container.querySelector<HTMLElement>(`.${LABEL_CLASS}`);
  if (label) label.textContent = text;
  const value_ = container.querySelector<HTMLElement>(`.${VALUE_CLASS}`);
  if (value_) {
    value_.textContent = text;
    value_.style.left = `${percent.toFixed(2)}%`;
  }
}

function formatSliderLabel(value: number): string {
  return `${value.toFixed(2).replace(/\.?0+$/, '')}x`;
}

/**
 * Imperative setter -- updates value + fill + label without firing the
 * slider's input event. Used by the controller after a click on a preset
 * button so the slider visually tracks the change.
 */
export function setSliderValue(container: Element, speed: number): void {
  const input = container.querySelector<HTMLInputElement>(`.${INPUT_CLASS}`);
  if (!input) return;
  input.value = String(speed);
  updateSliderFill(input);
}
