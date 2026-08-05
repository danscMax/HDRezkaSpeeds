/**
 * FEAT-020 placement decisions. This is the half that used to live inside the
 * background worker's closure, where vitest.config.ts's `src/entrypoints/**`
 * coverage exclusion meant no test could ever reach it — and two production
 * bugs hid there: a report rebuilt by hand that dropped fields, and the guard
 * deciding which candidate window may stay.
 */

import { describe, expect, it } from 'vitest';
import type { ScreenGeom } from '../../src/screens/dim-screens';
import {
  buildScreenReport,
  coverRect,
  isPlacementAcceptable,
  looksLikeSpoofedScreen,
  parseScreenReport,
} from '../../src/screens/placement';

/** A dim window as the page sees itself — the only inputs buildScreenReport reads. */
const fakeWindow = (over: Partial<Record<string, unknown>> = {}): Window =>
  ({
    devicePixelRatio: 1.5,
    screen: { availLeft: 2560, availTop: 0, availWidth: 1920, availHeight: 1040 },
    screenX: 2600,
    screenY: 100,
    outerWidth: 160,
    outerHeight: 120,
    ...over,
  }) as unknown as Window;

const geom = (
  availLeft: number,
  availTop = 0,
  availWidth = 2880,
  availHeight = 1560,
): ScreenGeom => ({
  availLeft,
  availTop,
  availWidth,
  availHeight,
});

describe('screen-report round trip', () => {
  it('survives build → wire → parse with css origin and self intact', () => {
    // The single assertion that would have caught the production bug: the
    // worker rebuilt the report field by field and silently dropped `self`
    // and the rect's origin, so coverRect() returned null on every call.
    const parsed = parseScreenReport({
      type: 'vs:screen-report',
      probeId: 'p1',
      ...buildScreenReport(fakeWindow()),
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.probeId).toBe('p1');
    expect(parsed?.report.css).toBeDefined();
    expect(parsed?.report.css?.l).toBe(2560);
    expect(parsed?.report.css?.t).toBe(0);
    expect(parsed?.report.self).toEqual({ x: 2600, y: 100, ow: 160, oh: 120 });
    // geom is physical pixels: 1920 CSS × 1.5 dpr.
    expect(parsed?.report.geom.availWidth).toBe(2880);
  });
});

describe('parseScreenReport', () => {
  const wire = buildScreenReport(fakeWindow());

  it('rejects a message without a probeId', () => {
    expect(parseScreenReport({ type: 'vs:screen-report', ...wire })).toBeNull();
  });

  it('rejects a non-object', () => {
    expect(parseScreenReport('vs:screen-report')).toBeNull();
    expect(parseScreenReport(null)).toBeNull();
  });

  it('rejects geometry that fails the wire guard', () => {
    expect(
      parseScreenReport({ ...wire, probeId: 'p1', geom: { availLeft: '0', availTop: 0 } }),
    ).toBeNull();
  });

  it('drops a css rect missing its origin instead of zeroing it', () => {
    // A phantom screen at (0,0) attracts every overlap test, so a partial
    // rect must not survive parsing at all.
    const parsed = parseScreenReport({
      ...wire,
      probeId: 'p1',
      css: { t: 0, w: 1920, h: 1040 },
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.report.css).toBeUndefined();
  });
});

describe('coverRect', () => {
  const css = { l: 2560, t: 0, w: 1920, h: 1040 };
  const self = { x: 2600, y: 100, ow: 160, oh: 120 };
  const api = { left: 3900, top: 150, width: 240 };

  it('returns null when the window never reported its own position', () => {
    expect(coverRect({ geom: geom(2560), css }, api)).toBeNull();
  });

  it('returns null when the css rect is missing', () => {
    expect(coverRect({ geom: geom(2560), self }, api)).toBeNull();
  });

  it('returns null when the window API gave nothing back', () => {
    expect(coverRect({ geom: geom(2560), css, self }, null)).toBeNull();
  });

  it('scales the screen rect into window-API coordinates', () => {
    // k = api.width / self.ow = 240 / 160 = 1.5.
    // left = 3900 - (2600 - 2560) * 1.5 = 3900 - 60 = 3840
    // top  = 150  - (100  - 0)    * 1.5 = 150 - 150 = 0
    // size = 1920 * 1.5 = 2880 × 1040 * 1.5 = 1560
    expect(coverRect({ geom: geom(2560), css, self }, api)).toEqual({
      left: 3840,
      top: 0,
      width: 2880,
      height: 1560,
    });
  });
});

describe('isPlacementAcceptable', () => {
  const target = geom(2560);
  const player = geom(0);

  it('accepts a window that landed on the wanted screen', () => {
    expect(isPlacementAcceptable({ landedOn: target, target, player, covered: [] })).toBe(true);
  });

  it('rejects a window that landed on the screen playing the film', () => {
    expect(isPlacementAcceptable({ landedOn: player, target: player, player, covered: [] })).toBe(
      false,
    );
  });

  it('rejects a screen that already has an overlay', () => {
    expect(isPlacementAcceptable({ landedOn: target, target, player, covered: [target] })).toBe(
      false,
    );
  });

  it('rejects a window that never reported where it landed', () => {
    expect(isPlacementAcceptable({ landedOn: null, target, player, covered: [] })).toBe(false);
  });

  it('accepts when the player screen is unknown (null disables that guard)', () => {
    // Deliberate: a null player must not veto every candidate — the caller
    // that passes null has already excluded the player's monitor.
    expect(isPlacementAcceptable({ landedOn: target, target, player: null, covered: [] })).toBe(
      true,
    );
  });
});

describe('coverRect rejects an implausible scale', () => {
  const geom = { availLeft: 0, availTop: 0, availWidth: 3840, availHeight: 2088 };
  const css = { l: 0, t: 0, w: 2560, h: 1392 };

  it('refuses a window that reported a near-zero outer width', () => {
    // The page answered before the window had settled: k explodes and the rect
    // would cover every monitor at once, film included.
    const report = { geom, css, self: { x: 0, y: 0, ow: 1, oh: 1 } };
    expect(coverRect(report, { left: 0, top: 0, width: 240 })).toBeNull();
  });

  it('refuses a scale far below any real zoom', () => {
    const report = { geom, css, self: { x: 0, y: 0, ow: 4000, oh: 3000 } };
    expect(coverRect(report, { left: 0, top: 0, width: 100 })).toBeNull();
  });

  it('still accepts an ordinary zoomed page', () => {
    // 125% zoom: outer 192 CSS px reported for a 240px window.
    const report = { geom, css, self: { x: 0, y: 0, ow: 192, oh: 128 } };
    expect(coverRect(report, { left: 0, top: 0, width: 240 })).not.toBeNull();
  });
});

describe('looksLikeSpoofedScreen', () => {
  const self = { x: 0, y: 0, ow: 240, oh: 160 };
  const geom = { availLeft: 0, availTop: 0, availWidth: 3840, availHeight: 2088 };

  it('flags a "screen" that is really the probe window', () => {
    // Firefox's anti-fingerprinting rewrites screen.avail* to the window size.
    expect(looksLikeSpoofedScreen({ geom, css: { l: 0, t: 0, w: 240, h: 160 }, self })).toBe(true);
  });

  it('does NOT flag a genuine single-monitor desktop', () => {
    // The trap a naive "all probes agree" check falls into.
    expect(looksLikeSpoofedScreen({ geom, css: { l: 0, t: 0, w: 2560, h: 1392 }, self })).toBe(
      false,
    );
  });

  it('says nothing when the report is incomplete', () => {
    expect(looksLikeSpoofedScreen({ geom })).toBe(false);
    expect(looksLikeSpoofedScreen({ geom, css: { l: 0, t: 0, w: 240, h: 160 } })).toBe(false);
  });
});
