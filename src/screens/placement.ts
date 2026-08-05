/**
 * FEAT-020 placement decisions: the wire format a dim window reports about the
 * screen it landed on, and the pure arithmetic/predicates the worker runs on
 * it.
 *
 * Lifted out of the background worker's closure so it can be unit-tested —
 * two production bugs (a hand-rebuilt report that dropped fields, and the
 * placement guard) lived here unreachable by any test. Like dim-screens.ts,
 * this module must stay importable from a PAGE context: no `wxt/browser`, no
 * browser globals at module top level — dim/main.ts builds its report with it.
 */

import type { Rect, ScreenGeom } from './dim-screens';
import { readScreenGeom, sameScreen } from './dim-screens';

/** What a dim window reports about the screen it landed on. */
export interface ProbeReport {
  geom: ScreenGeom;
  /** The screen the window landed on, as a CSS-pixel rect. Origin included:
   *  the handler only forwards it when all four numbers arrived. */
  css?: { l: number; t: number; w: number; h: number };
  /** The window's own CSS-space position and outer size, for the scale. */
  self?: { x: number; y: number; ow: number; oh: number };
}

/**
 * The report payload as a dim window builds it — the ONE definition of the
 * wire format, so the sender and the parser can't drift apart. They already
 * did once: the worker rebuilt the object field by field and silently dropped
 * `self` and the rect's origin.
 */
export function buildScreenReport(win: Window): {
  geom: ScreenGeom;
  css: { l: number; t: number; w: number; h: number };
  self: { x: number; y: number; ow: number; oh: number };
} {
  // availLeft/availTop are non-standard, so they are not on the Screen type.
  const s = win.screen as Screen & { availLeft?: number; availTop?: number };
  return {
    // The screen this window sits on, in physical pixels — the ONLY way Firefox
    // can tell one monitor from another, and zoom-proof (see readScreenGeom).
    geom: readScreenGeom(win),
    // The same screen as a CSS-pixel rectangle — the space windows.update
    // works in when the worker grows this window to cover the monitor.
    // Origin included, not just size: growing a window without moving it
    // only covers whatever lies down-right of wherever it happened to land.
    css: { l: s.availLeft ?? 0, t: s.availTop ?? 0, w: s.availWidth, h: s.availHeight },
    // Where this window sits inside that screen, in the SAME CSS space, plus
    // its outer size. Together with the size windows.get() reports, these let
    // the worker measure the scale between page pixels and window-API pixels
    // instead of assuming the two agree — they only agree at 100% zoom.
    self: { x: win.screenX, y: win.screenY, ow: win.outerWidth, oh: win.outerHeight },
  };
}

/** Wire-crossing guard: screen geometry arrives from a page. */
export function isScreenGeom(value: unknown): value is ScreenGeom {
  if (!value || typeof value !== 'object') return false;
  const g = value as Record<string, unknown>;
  return (
    typeof g.availLeft === 'number' &&
    typeof g.availTop === 'number' &&
    typeof g.availWidth === 'number' &&
    typeof g.availHeight === 'number'
  );
}

/**
 * Parse a `vs:screen-report` message off the wire.
 *
 * Forwards the WHOLE report. Rebuilding it field by field silently dropped
 * `self` and the rect's origin, which made coverRect() return null on every
 * call — so the arithmetic placement never ran once and every overlay fell
 * back to the fullscreen promotion it was written to replace.
 */
export function parseScreenReport(msg: unknown): { probeId: string; report: ProbeReport } | null {
  if (!msg || typeof msg !== 'object') return null;
  const m = msg as { probeId?: unknown; geom?: unknown; css?: unknown; self?: unknown };
  if (typeof m.probeId !== 'string' || !isScreenGeom(m.geom)) return null;
  const css = m.css as Record<string, unknown> | undefined;
  const self = m.self as Record<string, unknown> | undefined;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  return {
    probeId: m.probeId,
    report: {
      geom: m.geom,
      css:
        css && num(css.l) && num(css.t) && num(css.w) && num(css.h)
          ? { l: css.l, t: css.t, w: css.w, h: css.h }
          : undefined,
      self:
        self && num(self.x) && num(self.y) && num(self.ow) && num(self.oh)
          ? { x: self.x, y: self.y, ow: self.ow, oh: self.oh }
          : undefined,
    },
  };
}

/**
 * Turn "this small window is on the monitor we want" into "cover that
 * monitor", in the coordinates windows.update actually speaks.
 *
 * Measured on a real 3-monitor desktop (Firefox Dev 154, mixed 150%/176%
 * scaling): windows.get() and the page's own screenX/availLeft report the
 * SAME space, but only at 100% page zoom — the page's numbers are CSS
 * pixels, so any zoom divides them. The factor is therefore measured from
 * this very window (API width over outer width) rather than assumed, which
 * makes the result zoom-proof without knowing the zoom.
 *
 * Returns null when the report is too incomplete to compute from.
 */
export function coverRect(
  report: ProbeReport | null,
  api: { left?: number; top?: number; width?: number } | null,
): Rect | null {
  const css = report?.css;
  const self = report?.self;
  if (!css || !self || !api) return null;
  if (typeof css.l !== 'number' || typeof css.t !== 'number') return null;
  if (typeof api.left !== 'number' || typeof api.top !== 'number') return null;
  if (typeof api.width !== 'number' || !(self.ow > 0)) return null;
  const k = api.width / self.ow;
  if (!Number.isFinite(k) || k <= 0) return null;
  return {
    left: Math.round(api.left - (self.x - css.l) * k),
    top: Math.round(api.top - (self.y - css.t) * k),
    width: Math.round(css.w * k),
    height: Math.round(css.h * k),
  };
}

/**
 * Is the screen this candidate window actually landed on the one we may keep?
 *
 * Only a window that landed on the wanted screen — and not on the player's,
 * and not on one already covered — is raised and made fullscreen. A null
 * `player` deliberately disables the player-screen guard: on Chrome the
 * player's monitor is excluded before placement even starts, so there is no
 * geometry to compare against and "unknown" must not veto every candidate.
 */
export function isPlacementAcceptable({
  landedOn,
  target,
  player,
  covered,
}: {
  landedOn: ScreenGeom | null;
  target: ScreenGeom;
  player: ScreenGeom | null;
  covered: ScreenGeom[];
}): boolean {
  return (
    landedOn != null &&
    sameScreen(landedOn, target) &&
    !(player != null && sameScreen(landedOn, player)) &&
    !covered.some((seen) => sameScreen(seen, landedOn))
  );
}
