/**
 * FEAT-020 dim overlay window — and, in Firefox, the calibration probe.
 *
 * Opened by the background worker on every display except the one playing the
 * video; closed again on fullscreen exit. Two things ride in the URL hash
 * (`dim.html#l=85&p=probe-3`) because the background never focuses this window
 * and has no other channel into it:
 *
 *   l=<level>  fill level, 0..100. Anything unparseable falls back to the
 *              default rather than leaving a white window on a monitor.
 *   p=<id>     probe id — present only during Firefox calibration. The page
 *              reports which screen it landed on; the worker matches the id
 *              back to the coordinates it used.
 */

import { browser } from 'wxt/browser';
import { DEFAULT_DIM_LEVEL, dimColor, readScreenGeom } from '../../screens/dim-screens';

const params = new URLSearchParams(location.hash.slice(1));
const level = Number.parseInt(params.get('l') ?? '', 10);
document.body.style.background = dimColor(Number.isFinite(level) ? level : DEFAULT_DIM_LEVEL);

/**
 * Nothing may outlive the worker that opened it. A window nobody closes is a
 * black rectangle the user has to hunt down in the taskbar, so both roles
 * carry their own dead-man's switch:
 *
 *   probe   — closes itself a few seconds after reporting, no matter what.
 *   overlay — pings the worker; three misses (extension reloaded, disabled,
 *             updated) and it closes itself.
 */
const PROBE_LIFETIME_MS = 5000;
const HEARTBEAT_MS = 3000;
const MAX_MISSES = 3;

/** Set once the worker confirms this window is a real overlay, not a trial. */
let keep = false;

/** availLeft/availTop are non-standard, so they are not on the Screen type. */
const screenRect = (): { l: number; t: number; w: number; h: number } => {
  const s = window.screen as Screen & { availLeft?: number; availTop?: number };
  return { l: s.availLeft ?? 0, t: s.availTop ?? 0, w: s.availWidth, h: s.availHeight };
};

const probeId = params.get('p');
// `probe=1` marks a throwaway calibration window; an overlay also reports its
// screen (that is how placement is verified) but must NOT self-destruct.
const isProbe = params.get('probe') === '1';
if (probeId) {
  // The screen this window sits on, in physical pixels — the ONLY way Firefox
  // can tell one monitor from another, and zoom-proof (see readScreenGeom).
  browser.runtime
    .sendMessage({
      type: 'vs:screen-report',
      probeId,
      geom: readScreenGeom(window),
      // The same screen as a CSS-pixel rectangle — the space windows.update
      // works in when the worker grows this window to cover the monitor.
      // Origin included, not just size: growing a window without moving it
      // only covers whatever lies down-right of wherever it happened to land.
      css: screenRect(),
      // Where this window sits inside that screen, in the SAME CSS space, plus
      // its outer size. Together with the size windows.get() reports, these let
      // the worker measure the scale between page pixels and window-API pixels
      // instead of assuming the two agree — they only agree at 100% zoom.
      self: { x: window.screenX, y: window.screenY, ow: window.outerWidth, oh: window.outerHeight },
    })
    .catch(() => {
      /* worker gone — the timer below still gets rid of this window */
    });
}

// The worker verifies placement on a SMALL window, then grows it over the
// monitor. That must not move it across screens — but "must not" is not good
// enough for the one failure that blacks out the film, so the worker asks
// again afterwards, and this is the answer: where did I REALLY end up? A
// window that drifted onto the player's screen gets closed.
browser.runtime.onMessage.addListener((msg: unknown) => {
  const m = msg as { type?: unknown; probeId?: unknown } | null;
  if (!m || m.probeId !== probeId) return;
  if (m.type === 'vs:dim-keep') {
    keep = true;
  } else if (m.type === 'vs:dim-recheck') {
    void browser.runtime
      .sendMessage({
        type: 'vs:screen-report',
        probeId,
        geom: readScreenGeom(window),
        css: screenRect(),
        // Where this window sits inside that screen, in the SAME CSS space, plus
        // its outer size. Together with the size windows.get() reports, these let
        // the worker measure the scale between page pixels and window-API pixels
        // instead of assuming the two agree — they only agree at 100% zoom.
        self: {
          x: window.screenX,
          y: window.screenY,
          ow: window.outerWidth,
          oh: window.outerHeight,
        },
      })
      .catch(() => undefined);
  }
});

if (isProbe) {
  setTimeout(() => {
    if (!keep) window.close();
  }, PROBE_LIFETIME_MS);
} else {
  let misses = 0;
  setInterval(async () => {
    try {
      // `{ok: false}` means the worker no longer considers dimming active —
      // truthiness alone would keep a stale overlay alive forever.
      const res = (await browser.runtime.sendMessage({ type: 'vs:dim-ping' })) as
        | { ok?: boolean }
        | undefined;
      misses = res?.ok === true ? 0 : misses + 1;
    } catch {
      misses += 1;
    }
    if (misses >= MAX_MISSES) window.close();
  }, HEARTBEAT_MS);
}

// Escape hatch: if the window ever outlives its owner tab (worker evicted
// mid-teardown, tab crashed), a click gets rid of it without hunting for the
// window in the taskbar.
document.addEventListener('click', () => {
  window.close();
});
