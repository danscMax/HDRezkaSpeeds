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
import { DEFAULT_DIM_LEVEL, dimColor } from '../../screens/dim-screens';
import { buildScreenReport } from '../../screens/placement';

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
let heartbeat: ReturnType<typeof setInterval> | undefined;

/**
 * Ping the worker until it stops answering "dimming is active".
 *
 * Started by BOTH roles that end up as a real overlay — including a candidate
 * that gets promoted (`vs:dim-keep`), which is every overlay on the Firefox
 * path. Those windows are created as throwaway probes, so without this they
 * cancelled their self-close deadline and then had no dead-man's switch at
 * all: reload or disable the extension mid-film and the black rectangles
 * stayed on the monitors.
 */
function startHeartbeat(): void {
  if (heartbeat) return;
  let misses = 0;
  heartbeat = setInterval(async () => {
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

const probeId = params.get('p');
// `probe=1` marks a throwaway calibration window; an overlay also reports its
// screen (that is how placement is verified) but must NOT self-destruct.
const isProbe = params.get('probe') === '1';
if (probeId) {
  browser.runtime
    .sendMessage({ type: 'vs:screen-report', probeId, ...buildScreenReport(window) })
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
  const m = msg as {
    type?: unknown;
    probeId?: unknown;
    reportAs?: unknown;
    done?: unknown;
    total?: unknown;
    s?: unknown;
  } | null;
  if (!m || m.probeId !== probeId) return;
  if (m.type === 'vs:dim-keep') {
    keep = true;
    startHeartbeat();
  } else if (m.type === 'vs:dim-recheck') {
    // The calibration sweep moves ONE window across the grid and asks it
    // after every move; `reportAs` gives each answer its own id, so a late
    // reply from the previous position can't be credited to the next one.
    const as = typeof m.reportAs === 'string' ? m.reportAs : probeId;
    void browser.runtime
      .sendMessage({ type: 'vs:screen-report', probeId: as, ...buildScreenReport(window) })
      .catch(() => undefined);
  } else if (m.type === 'vs:sweep-progress' && card) {
    card.update(Number(m.done) || 0, Number(m.total) || 0, Number(m.s) || 0);
    armCardDeadline();
  }
});

/**
 * Calibration card: the one window that travels across the monitors during a
 * sweep shows what it is doing instead of being an anonymous black square.
 * Its dead-man's switch is progress itself — a sweep that stops reporting
 * (worker evicted) leaves no card behind.
 */
const CARD_STALE_MS = 5000;
let cardDeadline: ReturnType<typeof setTimeout> | undefined;
function armCardDeadline(): void {
  if (cardDeadline) clearTimeout(cardDeadline);
  cardDeadline = setTimeout(() => window.close(), CARD_STALE_MS);
}
const card = params.get('card') === '1' ? mountCard() : null;
if (card) armCardDeadline();

function mountCard(): { update: (done: number, total: number, s: number) => void } {
  const R = 22;
  const C = 2 * Math.PI * R;
  const SVG = 'http://www.w3.org/2000/svg';
  document.body.style.background = '#141416';
  document.body.replaceChildren();
  const style = document.createElement('style');
  style.textContent = `
    body { display:flex; align-items:center; justify-content:center; gap:10px;
      font-family:'Roboto',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color:#fff;
      background: radial-gradient(circle at 30% 50%, rgba(0,161,219,0.16), transparent 70%) #141416 !important; }
    .ring { position:relative; width:56px; height:56px; flex-shrink:0; }
    .ring svg { width:100%; height:100%; transform:rotate(-90deg); filter:drop-shadow(0 0 6px rgba(0,161,219,0.55)); }
    .ring circle { fill:none; stroke-width:4; }
    .ring .track { stroke:rgba(255,255,255,0.12); }
    .ring .bar { stroke:#00a1db; stroke-linecap:round; transition:stroke-dashoffset .25s ease; }
    .num { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
      font-size:15px; font-weight:700; letter-spacing:-0.3px; line-height:1; }
    .num small { font-size:9px; font-weight:500; color:rgba(255,255,255,0.55); margin-left:1px; }
    .txt { display:flex; flex-direction:column; gap:3px; min-width:0; }
    .label { font-size:11px; font-weight:600; line-height:1.2; color:rgba(255,255,255,0.92); }
    .eta { font-size:10px; color:rgba(255,255,255,0.55); font-variant-numeric:tabular-nums; }
    /* Firefox keeps a popup at ~132 px outside, ~124x100 inside: stack it. */
    @media (max-width: 150px) { body { flex-direction:column; gap:4px; }
      .ring { width:46px; height:46px; } .num { font-size:13px; }
      .txt { align-items:center; gap:1px; } }
    @media (prefers-reduced-motion: reduce) { .ring .bar { transition:none; } }
  `;
  document.head.appendChild(style);
  const ring = document.createElement('div');
  ring.className = 'ring';
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('width', '56');
  svg.setAttribute('height', '56');
  svg.setAttribute('viewBox', '0 0 56 56');
  const circle = (cls: string): SVGCircleElement => {
    const c = document.createElementNS(SVG, 'circle');
    c.setAttribute('class', cls);
    c.setAttribute('cx', '28');
    c.setAttribute('cy', '28');
    c.setAttribute('r', String(R));
    svg.appendChild(c);
    return c;
  };
  circle('track');
  const bar = circle('bar');
  bar.setAttribute('stroke-dasharray', String(C));
  bar.setAttribute('stroke-dashoffset', String(C));
  const num = document.createElement('div');
  num.className = 'num';
  ring.append(svg, num);
  const label = document.createElement('div');
  label.className = 'label';
  const eta = document.createElement('div');
  eta.className = 'eta';
  const txt = document.createElement('div');
  txt.className = 'txt';
  txt.append(label, eta);
  document.body.append(ring, txt);

  let t: ((key: string) => string) | null = null;
  let last = { done: 0, total: 0, s: 0 };
  const render = (): void => {
    const { done, total, s } = last;
    bar.setAttribute('stroke-dashoffset', String(total > 0 ? C * (1 - done / total) : C));
    num.textContent = total > 0 ? String(done) : '';
    if (total > 0) {
      const small = document.createElement('small');
      small.textContent = `/${total}`;
      num.appendChild(small);
    }
    if (t) {
      label.textContent = t('behavior.dim_screens.sweep.card');
      eta.textContent =
        total > 0 ? t('behavior.dim_screens.sweep.seconds').replace('{s}', String(s)) : '';
    }
  };
  // The translator is loaded AFTER the screen report went out: a probe must
  // answer fast, the words can arrive a frame later.
  void loadTranslator().then((tr) => {
    t = tr;
    render();
  });
  return {
    update: (done, total, s) => {
      last = { done, total, s };
      render();
    },
  };
}

async function loadTranslator(): Promise<(key: string) => string> {
  const [{ createTranslator }, { detectBrowserLang }, { SUPPORTED_LANGS }, { storageKeysFor }] =
    await Promise.all([
      import('../../i18n/translator'),
      import('../../i18n/detect'),
      import('../../i18n/dict'),
      import('../../config'),
    ]);
  const key = storageKeysFor('hdrezka').settings;
  const stored = (
    (await browser.storage.local.get(key).catch(() => ({}))) as Record<string, unknown>
  )[key] as { language?: unknown } | undefined;
  const lang =
    typeof stored?.language === 'string' &&
    (SUPPORTED_LANGS as readonly string[]).includes(stored.language)
      ? (stored.language as Parameters<typeof createTranslator>[0])
      : detectBrowserLang();
  const { t } = createTranslator(lang);
  return (k) => t(k as Parameters<typeof t>[0]);
}

if (isProbe && !card) {
  setTimeout(() => {
    if (!keep) window.close();
  }, PROBE_LIFETIME_MS);
} else {
  startHeartbeat();
}

// Escape hatch: if the window ever outlives its owner tab (worker evicted
// mid-teardown, tab crashed), a click gets rid of it without hunting for the
// window in the taskbar. Not for the calibration card: the sweep would only
// reopen it at the next point, and it closes itself when progress stops.
document.addEventListener('click', () => {
  if (!card) window.close();
});
