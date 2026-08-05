/**
 * FEAT-020 geometry + fill level. The browser-facing half (windows.create,
 * system.display) is covered by the live smoke run; this pins the pure logic
 * that decides WHICH monitors go dark — the part that, if wrong, blacks out
 * the screen the user is watching.
 */

import { describe, expect, it } from 'vitest';
import {
  calibrationPoints,
  DEFAULT_DIM_LEVEL,
  dedupeScreens,
  dimColor,
  pickOtherDisplays,
  readScreenGeom,
  type ScreenRecipe,
  sameScreen,
  screensTouchedByPlayer,
} from '../../src/screens/dim-screens';

const display = (left: number, top: number, width = 1920, height = 1080) => ({
  bounds: { left, top, width, height },
});

describe('pickOtherDisplays', () => {
  it('returns nothing on a single-display setup', () => {
    expect(
      pickOtherDisplays([display(0, 0)], { left: 0, top: 0, width: 800, height: 600 }),
    ).toEqual([]);
  });

  it('skips the display holding the player window', () => {
    const primary = display(0, 0);
    const secondary = display(1920, 0);
    const others = pickOtherDisplays([primary, secondary], {
      left: 100,
      top: 50,
      width: 1000,
      height: 700,
    });
    expect(others).toEqual([secondary]);
  });

  it('keeps the screen showing most of a straddling window', () => {
    const left = display(0, 0);
    const right = display(1920, 0);
    // 1200px wide window, only 200px of it on the left screen.
    const others = pickOtherDisplays([left, right], {
      left: 1720,
      top: 0,
      width: 1200,
      height: 900,
    });
    expect(others).toEqual([left]);
  });

  it('dims every other display in a three-monitor setup', () => {
    const a = display(-1920, 0);
    const b = display(0, 0);
    const c = display(1920, 0);
    const others = pickOtherDisplays([a, b, c], { left: 10, top: 10, width: 800, height: 600 });
    expect(others).toEqual([a, c]);
  });

  it('still dims something when the window is off every display (minimised/offscreen)', () => {
    const a = display(0, 0);
    const b = display(1920, 0);
    const others = pickOtherDisplays([a, b], {
      left: -32000,
      top: -32000,
      width: 800,
      height: 600,
    });
    // No overlap anywhere — the first display is assumed to be the host, and
    // the rest go dark. Never all of them.
    expect(others).toEqual([b]);
  });
});

describe('Firefox calibration helpers', () => {
  const screen = (availLeft: number, availTop: number, availWidth = 2560, availHeight = 1392) => ({
    availLeft,
    availTop,
    availWidth,
    availHeight,
  });
  const recipe = (rawLeft: number, rawTop: number, geom: ReturnType<typeof screen>) => ({
    ...geom,
    rawLeft,
    rawTop,
    // CSS rect is what windows.update takes, and what the player's window is
    // compared against; identity still compares the physical values above.
    cssLeft: Math.round(geom.availLeft / 1.5),
    cssTop: Math.round(geom.availTop / 1.5),
    cssWidth: Math.round(geom.availWidth / 1.5),
    cssHeight: Math.round(geom.availHeight / 1.5),
  });

  it('probes the extremes in every direction plus offset columns', () => {
    const points = calibrationPoints();
    const xs = new Set(points.map((p) => p.rawLeft));
    const ys = new Set(points.map((p) => p.rawTop));
    // The measured facts this grid is built on: extremes reach the outermost
    // screen, mid-range values catch screens offset along the other axis.
    expect(xs.has(100000) && xs.has(-100000)).toBe(true);
    expect(ys.has(100000) && ys.has(-100000)).toBe(true);
    expect(points.length).toBeGreaterThan(8);
    // Every X is tried at every Y — a screen offset on both axes (the case a
    // four-corner sweep misses) still gets a candidate.
    expect(points.length).toBe(xs.size * ys.size);
  });

  it('treats identical geometry as the same screen', () => {
    expect(sameScreen(screen(0, 0), screen(0, 0))).toBe(true);
    expect(sameScreen(screen(0, 0), screen(2176, 0, 2176, 1176))).toBe(false);
  });

  it('recognises ONE monitor seen through two different page zooms', () => {
    // The bug this guards: screen.* is in CSS pixels, so a zoomed page and an
    // unzoomed probe describe the same monitor with different numbers — and
    // the screen playing the video stopped being recognised as its own.
    const fakeWindow = (dpr: number, cssWidth: number, cssHeight: number): Window =>
      ({
        devicePixelRatio: dpr,
        screen: { availLeft: 0, availTop: 0, availWidth: cssWidth, availHeight: cssHeight },
      }) as unknown as Window;

    // 2560×1392 physical: probe at 150% OS scale, page also zoomed to 120%.
    const fromProbe = readScreenGeom(fakeWindow(1.5, 2560, 1392));
    const fromZoomedPage = readScreenGeom(fakeWindow(1.8, 2133, 1160));

    expect(sameScreen(fromProbe, fromZoomedPage)).toBe(true);
    // Raw CSS values would NOT have matched — that was the defect.
    const rawProbe = { availLeft: 0, availTop: 0, availWidth: 2560, availHeight: 1392 };
    const rawZoomed = { availLeft: 0, availTop: 0, availWidth: 2133, availHeight: 1160 };
    expect(sameScreen(rawProbe, rawZoomed)).toBe(false);
  });

  it('still separates genuinely different monitors after normalisation', () => {
    const primary = { availLeft: 0, availTop: 0, availWidth: 3840, availHeight: 2088 };
    const second = { availLeft: 3840, availTop: 0, availWidth: 3264, availHeight: 1764 };
    expect(sameScreen(primary, second)).toBe(false);
  });

  it('keeps the FIRST recipe per distinct screen', () => {
    const primary = screen(0, 0);
    const second = screen(2176, 0, 2176, 1176);
    const map = dedupeScreens([
      recipe(-100000, 0, primary),
      recipe(0, 0, primary),
      recipe(100000, 0, second),
      recipe(100000, 4000, second),
    ]);
    expect(map).toHaveLength(2);
    expect(map[0]?.rawLeft).toBe(-100000);
    expect(map[1]?.rawLeft).toBe(100000);
  });
});

describe('dimColor', () => {
  it('maps 100 to black and 0 to white', () => {
    expect(dimColor(100)).toBe('rgb(0, 0, 0)');
    expect(dimColor(0)).toBe('rgb(255, 255, 255)');
  });

  it('defaults to pure black — a grey default reads as a bug', () => {
    expect(DEFAULT_DIM_LEVEL).toBe(100);
    expect(dimColor(DEFAULT_DIM_LEVEL)).toBe('rgb(0, 0, 0)');
  });

  it('still offers a softer wall lower down the slider', () => {
    expect(dimColor(85)).toBe('rgb(38, 38, 38)');
  });

  it('clamps junk input instead of emitting an invalid colour', () => {
    expect(dimColor(140)).toBe('rgb(0, 0, 0)');
    expect(dimColor(-20)).toBe('rgb(255, 255, 255)');
  });
});

describe('screensTouchedByPlayer — which monitors the film window is on', () => {
  const screen = (
    cssLeft: number,
    cssTop: number,
    cssWidth: number,
    cssHeight: number,
  ): ScreenRecipe => ({
    availLeft: cssLeft,
    availTop: cssTop,
    availWidth: cssWidth,
    availHeight: cssHeight,
    rawLeft: 0,
    rawTop: 0,
    cssLeft,
    cssTop,
    cssWidth,
    cssHeight,
  });

  // Real geometry, measured on a 3-monitor desktop 2026-08-05.
  const primary = screen(0, 0, 2560, 1392);
  const right = screen(2176, 0, 2176, 1176);
  const below = screen(479, 1440, 2293, 912);
  const map = [primary, right, below];

  it('excludes the screen the window sits on', () => {
    expect(screensTouchedByPlayer(map, { left: 10, top: 10, width: 1200, height: 800 })).toEqual([
      primary,
    ]);
    expect(screensTouchedByPlayer(map, { left: 600, top: 1500, width: 800, height: 600 })).toEqual([
      below,
    ]);
  });

  it('does NOT claim a neighbour touched only by the phantom band', () => {
    // Mixed-DPI desktops store each screen's rect in its own scale, so the
    // primary (0..2560) and the right-hand screen (2176..4352) overlap by
    // 384px of nothing. A window filling the primary clips that band, and
    // excluding the neighbour on that basis left it permanently undimmed.
    const touched = screensTouchedByPlayer(map, { left: 0, top: 0, width: 2560, height: 1392 });
    expect(touched).toEqual([primary]);
  });

  it('claims both when the window genuinely straddles two monitors', () => {
    // Half the window on each — blacking out either one would cover the film.
    const touched = screensTouchedByPlayer(map, { left: 1800, top: 100, width: 1400, height: 800 });
    expect(touched).toContain(primary);
    expect(touched).toContain(right);
  });

  it('returns nothing when the window is off every screen on record', () => {
    expect(screensTouchedByPlayer([], { left: 0, top: 0, width: 100, height: 100 })).toEqual([]);
    expect(
      screensTouchedByPlayer(map, { left: -9000, top: -9000, width: 100, height: 100 }),
    ).toEqual([]);
  });
});
