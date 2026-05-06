/**
 * Inline SVG icon set, Lucide-style (stroke=2). Self-contained so we never
 * pull a font or external CSS for a 14px glyph.
 *
 * Ported from .user.js:4066-4097 plus the `globe` icon added for the
 * language-switcher row. Originally rendered as HTML strings; rewritten
 * 2026-04-28 to construct `SVGElement` instances programmatically (audit
 * follow-up to 0.1.34) so the bundled JS contains no HTML-parsing API
 * calls — that's what AMO's static analyzer flags as "Unsafe call to ...".
 *
 * Color is `currentColor` so callers can theme via CSS without rebuilding
 * the SVG; size defaults to 14px which matches the userscript's panel UI.
 */

import { svgEl } from './dom-h';

export type IconName =
  | 'settings'
  | 'sliders'
  | 'keyboard'
  | 'wrench'
  | 'refresh-cw'
  | 'clipboard'
  | 'trash'
  | 'alert'
  | 'plus'
  | 'minus'
  | 'x'
  | 'chevron-up'
  | 'chevron-down'
  | 'chevrons-up'
  | 'chevrons-down'
  | 'panel-right'
  | 'panel-bottom'
  | 'tv'
  | 'lock'
  | 'rotate-ccw'
  | 'check-circle'
  | 'eye-off'
  | 'globe'
  | 'heart'
  | 'external-link'
  | 'help-circle';

/**
 * Icon spec — array of [tag, attrs] tuples. Each tuple becomes an SVG
 * primitive child (path, circle, line, rect, polyline) with the given
 * attributes. Coordinate space is the standard Lucide 24×24 viewBox.
 */
type SvgPart = readonly [tag: string, attrs: Record<string, string | number>];

const VS_ICONS: Record<IconName, readonly SvgPart[]> = {
  'settings': [
    ['circle', { cx: 12, cy: 12, r: 3 }],
    ['path', { d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' }],
  ],
  'sliders': [
    ['line', { x1: 4, y1: 21, x2: 4, y2: 14 }],
    ['line', { x1: 4, y1: 10, x2: 4, y2: 3 }],
    ['line', { x1: 12, y1: 21, x2: 12, y2: 12 }],
    ['line', { x1: 12, y1: 8, x2: 12, y2: 3 }],
    ['line', { x1: 20, y1: 21, x2: 20, y2: 16 }],
    ['line', { x1: 20, y1: 12, x2: 20, y2: 3 }],
    ['line', { x1: 1, y1: 14, x2: 7, y2: 14 }],
    ['line', { x1: 9, y1: 8, x2: 15, y2: 8 }],
    ['line', { x1: 17, y1: 16, x2: 23, y2: 16 }],
  ],
  'keyboard': [
    ['rect', { x: 2, y: 4, width: 20, height: 16, rx: 2 }],
    ['path', { d: 'M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10' }],
  ],
  'wrench': [
    ['path', { d: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z' }],
  ],
  'refresh-cw': [
    ['polyline', { points: '23 4 23 10 17 10' }],
    ['polyline', { points: '1 20 1 14 7 14' }],
    ['path', { d: 'M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15' }],
  ],
  'clipboard': [
    ['rect', { x: 8, y: 2, width: 8, height: 4, rx: 1, ry: 1 }],
    ['path', { d: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2' }],
  ],
  'trash': [
    ['polyline', { points: '3 6 5 6 21 6' }],
    ['path', { d: 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m5 0V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2' }],
  ],
  'alert': [
    ['path', { d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z' }],
    ['line', { x1: 12, y1: 9, x2: 12, y2: 13 }],
    ['line', { x1: 12, y1: 17, x2: 12.01, y2: 17 }],
  ],
  'plus': [
    ['path', { d: 'M12 5v14M5 12h14' }],
  ],
  'minus': [
    ['path', { d: 'M5 12h14' }],
  ],
  'x': [
    ['path', { d: 'M18 6 6 18M6 6l12 12' }],
  ],
  'chevron-up': [
    ['polyline', { points: '6 15 12 9 18 15' }],
  ],
  'chevron-down': [
    ['polyline', { points: '6 9 12 15 18 9' }],
  ],
  'chevrons-up': [
    ['polyline', { points: '17 11 12 6 7 11' }],
    ['polyline', { points: '17 18 12 13 7 18' }],
  ],
  'chevrons-down': [
    ['polyline', { points: '7 13 12 18 17 13' }],
    ['polyline', { points: '7 6 12 11 17 6' }],
  ],
  'panel-right': [
    ['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }],
    ['line', { x1: 15, y1: 3, x2: 15, y2: 21 }],
  ],
  'panel-bottom': [
    ['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }],
    ['line', { x1: 3, y1: 15, x2: 21, y2: 15 }],
  ],
  'tv': [
    ['rect', { x: 2, y: 7, width: 20, height: 15, rx: 2 }],
    ['polyline', { points: '17 2 12 7 7 2' }],
  ],
  'lock': [
    ['rect', { x: 3, y: 11, width: 18, height: 11, rx: 2, ry: 2 }],
    ['path', { d: 'M7 11V7a5 5 0 0 1 10 0v4' }],
  ],
  'rotate-ccw': [
    ['polyline', { points: '1 4 1 10 7 10' }],
    ['path', { d: 'M3.51 15a9 9 0 1 0 2.13-9.36L1 10' }],
  ],
  'check-circle': [
    ['path', { d: 'M22 11.08V12a10 10 0 1 1-5.93-9.14' }],
    ['polyline', { points: '22 4 12 14.01 9 11.01' }],
  ],
  'eye-off': [
    ['path', { d: 'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24' }],
    ['line', { x1: 1, y1: 1, x2: 23, y2: 23 }],
  ],
  'globe': [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['line', { x1: 2, y1: 12, x2: 22, y2: 12 }],
    ['path', { d: 'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z' }],
  ],
  'heart': [
    ['path', { d: 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z' }],
  ],
  'external-link': [
    ['path', { d: 'M15 3h6v6' }],
    ['path', { d: 'M10 14L21 3' }],
    ['path', { d: 'M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5' }],
  ],
  'help-circle': [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['path', { d: 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3' }],
    ['line', { x1: 12, y1: 17, x2: 12.01, y2: 17 }],
  ],
};

/**
 * Build a Lucide-style stroked SVG icon as a real `SVGElement`.
 * Caller inserts via `appendChild` / `replaceChildren` — no string parsing.
 */
export function vsIcon(name: IconName, size = 14): SVGElement {
  const root = svgEl('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  });
  for (const [tag, attrs] of VS_ICONS[name] ?? []) {
    root.appendChild(svgEl(tag, attrs));
  }
  return root;
}

/** Available icon names, exported for type-safe enumeration. */
export const ICON_NAMES = Object.keys(VS_ICONS) as IconName[];

/**
 * Filled Material-style cog used for the in-player gear button (Wave V).
 * Distinct from the Lucide stroked `settings` icon used elsewhere — the
 * userscript baseline uses the filled idiom on the gear specifically and
 * stroked icons inside the modal. The `data-filled` marker exempts this
 * SVG from the SVG-protection rule that forces `fill:none` on all other
 * icons inside `.vs-panel` / `.settings-menu` (see styles.ts).
 *
 * Path verbatim from .user.js:4046.
 */
const FILLED_GEAR_PATH =
  'M12 15.5A3.5 3.5 0 0 1 8.5 12A3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5a3.5 3.5 0 0 1-3.5 3.5m7.43-2.53c.04-.32.07-.64.07-.97c0-.33-.03-.66-.07-1l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.31-.61-.22l-2.49 1c-.52-.39-1.06-.73-1.69-.98l-.37-2.65A.506.506 0 0 0 14 2h-4c-.25 0-.46.18-.5.42l-.37 2.65c-.63.25-1.17.59-1.69.98l-2.49-1c-.22-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L4.57 11c-.04.34-.07.67-.07 1c0 .33.03.65.07.97l-2.11 1.66c-.19.15-.25.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1.01c.52.4 1.06.74 1.69.99l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.37-2.65c.63-.26 1.17-.59 1.69-.99l2.49 1.01c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64z';

export function vsFilledGearIcon(size = 16): SVGElement {
  return svgEl(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      'data-filled': '',
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'currentColor',
    },
    svgEl('path', { d: FILLED_GEAR_PATH }),
  );
}
