/**
 * FEAT-020: dim the OTHER monitors while a video plays fullscreen.
 *
 * A browser window can't be translucent, so "dim" means: cover every display
 * that isn't showing the player with an opaque extension window whose fill is
 * darker the higher the level. 100 = pure black, lower = dark grey (a soft
 * anchor for peripheral vision instead of a void). Below ~60 the fill is
 * LIGHTER than a typical desktop — that's the user's call, not a bug.
 *
 * Two very different ways to learn where the monitors are:
 *
 *   Chrome  — `chrome.system.display.getInfo()`. Exact bounds, no side effects.
 *   Firefox — no such API (open request on Mozilla Connect; the standard
 *             Window Management API is unshipped there too), so the monitors
 *             are found by PROBING: a window is created at a set of guessed
 *             global coordinates and the page inside reports the screen it
 *             landed on via the non-standard `screen.availLeft/availTop`.
 *             Measured behaviour that shapes the design (Firefox 145, Win11):
 *               - small offsets are clamped back onto the current screen, so
 *                 "current window + width" never reaches the next monitor;
 *               - extreme values (±100000) DO land on the outermost screen;
 *               - the coordinates passed to windows.create are NOT the ones
 *                 windows.get returns (×1.5 on a 150%-scaled desktop), so the
 *                 recipe that reached a screen is stored verbatim and replayed
 *                 later instead of being recomputed from geometry.
 *             The result is cached, so probing runs once per layout change.
 *
 * Pure geometry lives here so it can be unit-tested without a browser.
 */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Default fill level, in percent. 100 = pure black: "dim the other monitors"
 * reads as BLACK to people, and a grey default looks like a bug rather than a
 * setting. Anyone who wants a softer wall lowers the slider (85 ≈ #262626).
 */
export const DEFAULT_DIM_LEVEL = 100;

/**
 * True in both extension builds, false in the userscript one.
 * `import.meta.env.BROWSER` is WXT's build-time target ('chrome' | 'firefox');
 * the userscript build (plain Vite) doesn't define it at all.
 */
export const CAN_DIM_SCREENS =
  import.meta.env.BROWSER === 'chrome' || import.meta.env.BROWSER === 'firefox';

/**
 * Firefox has no display API, so the monitors must be probed once and cached —
 * which means the settings UI needs a "find my monitors" button there and not
 * in Chrome.
 */
export const NEEDS_SCREEN_CALIBRATION = import.meta.env.BROWSER === 'firefox';

/**
 * Identity of a screen, as reported from a page sitting on it — in PHYSICAL
 * pixels, not CSS ones.
 *
 * `screen.availWidth` and friends are CSS pixels, so page zoom changes them:
 * the same monitor reads as 2560×1392 from a 100% page and 2133×1160 from a
 * 120% one. The player's page and the extension's own probe windows almost
 * never share a zoom level, so comparing raw CSS values decided "different
 * screen" for the SAME monitor — and the player's own screen got dimmed.
 * Multiplying by devicePixelRatio (which folds in both zoom and OS scaling)
 * gives a value both contexts agree on.
 */
export interface ScreenGeom {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
}

/** Read the current window's screen in physical pixels. */
export function readScreenGeom(win: Window): ScreenGeom {
  const s = win.screen as Screen & { availLeft?: number; availTop?: number };
  const dpr = win.devicePixelRatio || 1;
  const px = (v: number): number => Math.round(v * dpr);
  return {
    availLeft: px(s.availLeft ?? 0),
    availTop: px(s.availTop ?? 0),
    availWidth: px(s.availWidth),
    availHeight: px(s.availHeight),
  };
}

/**
 * A screen plus the create-coordinates that are known to reach it, plus its
 * size in CSS pixels.
 *
 * Both sizes are needed and they are NOT interchangeable: identity is
 * compared in physical pixels (zoom-proof), but windows.update takes CSS
 * pixels — feeding it the physical size made the window huge, which Firefox
 * "fixed" by throwing it to (-21333,-21333) at 158×26, i.e. off every
 * monitor. Measured, not theorised.
 */
export interface ScreenRecipe extends ScreenGeom {
  rawLeft: number;
  rawTop: number;
  cssLeft: number;
  cssTop: number;
  cssWidth: number;
  cssHeight: number;
}

/**
 * The screen as a rectangle in the coordinate space `windows.get` reports and
 * `windows.update` accepts. Measured 2026-08-05 on a 3-monitor desktop: that
 * space and the page's own CSS pixels agree, so a calibrated screen can be
 * compared directly against a browser window's rect.
 *
 * This is how the monitor showing the player is identified now. It used to be
 * identified from `screen.avail*` read in the CONTENT SCRIPT — which Firefox's
 * fingerprinting protection falsifies, so the player's own monitor matched
 * nothing and was dimmed along with the rest.
 */
export function screenCssRect(s: ScreenRecipe): Rect {
  return { left: s.cssLeft, top: s.cssTop, width: s.cssWidth, height: s.cssHeight };
}

/**
 * Coordinates handed to windows.create during calibration.
 *
 * ponytail: a fixed heuristic grid, not a search. ±FAR finds the outermost
 * screen in each direction (measured), and the mid-range values catch monitors
 * that are offset along the other axis — the case a pure four-corner sweep
 * misses (a screen below-and-right of the primary reports the PRIMARY's
 * geometry when probed at x=0). A layout whose screens fall between these
 * columns won't be found; upgrade path is a BFS outward from each screen
 * already discovered, at ~1 extra probe per edge.
 */
export function calibrationPoints(): { rawLeft: number; rawTop: number }[] {
  const FAR = 100000;
  const xs = [-FAR, -2500, 0, 2500, 5000, 8000, FAR];
  const ys = [-FAR, 0, 2000, 4000, FAR];
  const points: { rawLeft: number; rawTop: number }[] = [];
  for (const rawTop of ys) {
    for (const rawLeft of xs) points.push({ rawLeft, rawTop });
  }
  return points;
}

/**
 * Same physical screen? Geometry is the only identity a probe can report.
 * The tolerance absorbs the rounding of the devicePixelRatio conversion —
 * exact equality across two differently-zoomed contexts is not achievable.
 */
const SCREEN_MATCH_TOLERANCE_PX = 8;

export function sameScreen(a: ScreenGeom, b: ScreenGeom): boolean {
  const near = (x: number, y: number): boolean => Math.abs(x - y) <= SCREEN_MATCH_TOLERANCE_PX;
  return (
    near(a.availLeft, b.availLeft) &&
    near(a.availTop, b.availTop) &&
    near(a.availWidth, b.availWidth) &&
    near(a.availHeight, b.availHeight)
  );
}

/** First-wins dedupe of probe results into one recipe per distinct screen. */
export function dedupeScreens(found: ScreenRecipe[]): ScreenRecipe[] {
  const out: ScreenRecipe[] = [];
  for (const candidate of found) {
    if (!out.some((seen) => sameScreen(seen, candidate))) out.push(candidate);
  }
  return out;
}

/**
 * Every calibrated screen the player's window touches at all.
 *
 * Deliberately NOT "the single screen with the largest overlap". Each screen's
 * CSS rect is expressed in ITS OWN monitor's scale, so on a desktop with mixed
 * DPI the rects overlap — measured: a primary at 0..2560 and a right-hand
 * screen at 2176..4352 share a 384px phantom band. Inside that band "largest
 * overlap" can elect the wrong monitor, and electing wrong means blacking out
 * the film. Excluding every screen the window touches can only ever dim FEWER
 * monitors than intended, which is the harmless direction to be wrong in.
 *
 * This replaced identifying the screen from `screen.avail*` read in the
 * content script: Firefox's fingerprinting protection falsifies those values
 * (it warns about it in the page console), so the player's own monitor matched
 * no calibrated screen and was dimmed along with the others.
 */
export function screensTouchedByPlayer(map: ScreenRecipe[], playerWindow: Rect): ScreenRecipe[] {
  const windowArea = Math.max(1, playerWindow.width * playerWindow.height);
  const scored = map
    .map((screen) => ({ screen, area: overlapArea(screenCssRect(screen), playerWindow) }))
    .filter((s) => s.area > 0);
  if (scored.length === 0) return [];
  const best = scored.reduce((a, b) => (b.area > a.area ? b : a));
  // The screen with the largest overlap is certainly the film's. A second
  // screen is only claimed as well when it holds a real share of the window —
  // a sliver of contact is the phantom band, not a monitor the film is on.
  // Without the threshold a neighbour was excluded on 384px of phantom and
  // never got dimmed at all; without the "claim more than one" rule at all, a
  // window genuinely straddling two monitors blacks out half the film.
  const SHARE_TO_CLAIM = 0.2;
  return scored
    .filter((s) => s === best || s.area / windowArea >= SHARE_TO_CLAIM)
    .map((s) => s.screen);
}

/** Every calibrated screen except the one the player is on. */
export function otherScreens(map: ScreenRecipe[], player: ScreenGeom): ScreenRecipe[] {
  return map.filter((screen) => !sameScreen(screen, player));
}

/** Level (0..100) → opaque grey fill. 100 → black, 0 → white. */
export function dimColor(level: number): string {
  const pct = Math.min(100, Math.max(0, Math.round(level)));
  const grey = Math.round(255 * (1 - pct / 100));
  return `rgb(${grey}, ${grey}, ${grey})`;
}

/** Area shared by two rectangles, 0 when they don't intersect. */
export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Every display EXCEPT the one the player's window sits on — that one is
 * picked by largest overlap, so a window straddling two monitors keeps the
 * screen showing most of it. Single-display setups return [] (nothing to dim).
 *
 * Generic over the display shape so the caller can pass Chrome's
 * DisplayUnitInfo straight through and get the same objects back.
 */
export function pickOtherDisplays<T extends { bounds: Rect }>(displays: T[], window: Rect): T[] {
  if (displays.length < 2) return [];
  let hostIndex = 0;
  let bestOverlap = -1;
  displays.forEach((display, i) => {
    const area = overlapArea(display.bounds, window);
    if (area > bestOverlap) {
      bestOverlap = area;
      hostIndex = i;
    }
  });
  return displays.filter((_, i) => i !== hostIndex);
}
