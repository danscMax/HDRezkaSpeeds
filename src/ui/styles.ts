/**
 * CSS injection for the in-player UI.
 *
 * Wave 1.8a ships the rules needed for the modules created in this wave
 * (notifications, popup, slider, buttons, settings modal). The full set
 * with per-site theming and player-overlay positioning lives in
 * src/ui/styles-full.css equivalent and gets injected by Wave 1.8c
 * (insertion + layout).
 *
 * Idempotent on the <style> tag id: safe to call multiple times during
 * SPA re-attach.
 */

import type { AppContext } from '../app/context';
import type { Site } from '../app/ports';

const STYLE_ID = 'vs-styles';

export function injectStyles(site: Site, container: Document = document): void {
  detectAndApplyTheme(site, container);
  if (container.getElementById(STYLE_ID)) return;
  const style = container.createElement('style');
  style.id = STYLE_ID;
  style.textContent = BASE_STYLES;
  (container.head || container.documentElement).appendChild(style);
}

export function removeStyles(container: Document = document): void {
  container.getElementById(STYLE_ID)?.remove();
  delete container.documentElement.dataset.vsTheme;
}

/**
 * Decide the theme by checking, in order:
 *   1. Explicit theme markers on <html> / <body> (data-theme,
 *      data-color-scheme, .dark / .light / .b-body--dark / .b-body--white
 *      class names) — survives the cold-load race where HDRezka applies
 *      its theme via JS AFTER our content script first runs.
 *   2. Luminance walk from `referenceEl` (panel's parent) up to <html>
 *      with a body-text-color cross-check for sites that keep <body>
 *      visually dark regardless of theme (HDRezka's exact case).
 *   3. OS prefers-color-scheme fallback.
 *   4. Default 'dark' — HDRezka's main skin is dark.
 */
export function detectAndApplyTheme(
  site: Site,
  container: Document = document,
  referenceEl?: Element | null,
): void {
  void site;
  const root = container.documentElement;
  const theme: 'dark' | 'light' =
    detectFromAttributes(root, container.body) ??
    detectByLuminance(referenceEl ?? container.body, container) ??
    preferredColorScheme(container) ??
    'dark';
  root.dataset.vsTheme = theme;
}

/**
 * Heuristic theme detection from common attribute/class markers on
 * <html> and <body>. Order matters: explicit data-theme wins over
 * class-based detection, and 'dark' wins over 'light' when both happen
 * to be present (HDRezka transitions sometimes leave both classes for
 * a frame). Returns null when nothing recognisable is set.
 */
function detectFromAttributes(root: Element, body: HTMLElement | null): 'dark' | 'light' | null {
  const probes = body ? [root, body] : [root];
  // Explicit data-* attributes first.
  for (const el of probes) {
    const dt = el.getAttribute('data-theme') ?? el.getAttribute('data-color-scheme');
    if (dt === 'dark' || dt === 'light') return dt;
  }
  // HDRezka-specific class markers + generic dark/light classes.
  for (const el of probes) {
    const cl = el.classList;
    if (
      cl.contains('b-body--dark') ||
      cl.contains('dark-theme') ||
      cl.contains('theme-dark') ||
      cl.contains('dark')
    ) {
      return 'dark';
    }
    if (
      cl.contains('b-body--white') ||
      cl.contains('b-body--light') ||
      cl.contains('light-theme') ||
      cl.contains('theme-light') ||
      cl.contains('light')
    ) {
      return 'light';
    }
  }
  return null;
}

function preferredColorScheme(container: Document): 'dark' | 'light' | null {
  try {
    const mql = container.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
    if (mql) return mql.matches ? 'dark' : 'light';
  } catch {
    /* swallow */
  }
  return null;
}

interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseRgb(s: string | null | undefined): RGBA | null {
  if (!s) return null;
  const m = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)/.exec(s);
  if (!m) return null;
  return {
    r: Number(m[1]),
    g: Number(m[2]),
    b: Number(m[3]),
    a: m[4] !== undefined ? Number(m[4]) : 1,
  };
}

/**
 * Walk up from `start` finding the first ancestor with an opaque-enough
 * background (alpha >= 0.1). Decide via YIQ luminance (lum > 160 = light).
 * Falls back to body, then to <html>. Returns null when no usable background
 * surfaces -- caller layers on prefers-color-scheme.
 */
function detectByLuminance(start: Element | null, container: Document): 'dark' | 'light' | null {
  const win = container.defaultView;
  if (!win) return null;
  let bg: RGBA | null = null;
  // Walk from the panel's PARENT (mirrors the reference TM script
  // .user.js:1631) — the panel itself is intentionally transparent so
  // starting at the panel would always skip to its parent anyway, but
  // beginning at parentElement makes the "surrounding context" intent
  // explicit. When there's no reference (e.g. popup) we start at body.
  const startFrom = start?.parentElement ?? container.body;
  for (let el: Element | null = startFrom; el; el = el.parentElement) {
    let cs: CSSStyleDeclaration;
    try {
      cs = win.getComputedStyle(el);
    } catch {
      continue;
    }
    const parsed = parseRgb(cs.backgroundColor);
    if (parsed && parsed.a >= 0.1) {
      bg = parsed;
      break;
    }
  }
  if (!bg && container.body) {
    const bodyBg = parseRgb(win.getComputedStyle(container.body).backgroundColor);
    if (bodyBg && bodyBg.a >= 0.1) bg = bodyBg;
  }
  if (!bg) {
    const htmlBg = parseRgb(win.getComputedStyle(container.documentElement).backgroundColor);
    if (htmlBg && htmlBg.a >= 0.1) bg = htmlBg;
  }
  if (!bg) return null;
  const lum = 0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b;
  let theme: 'dark' | 'light' = lum > 160 ? 'light' : 'dark';

  // Cross-check against body's text color. Some sites (HDRezka in
  // particular) keep <body> at a fixed near-black background regardless
  // of theme — the visible page colour is painted by inner content
  // wrappers. When that happens our luminance walk locks onto the dark
  // body bg and reports 'dark' even on the visually light skin. Body's
  // *text* color flips correctly across themes (white text on dark,
  // dark text on light), so we use it to disambiguate borderline cases:
  // if the bg lum is near-black BUT body text is dark too, the page is
  // really light. Threshold lum<60 picks up the rgb(2,5,14) HDRezka
  // body without false-flagging genuine dark themes (which usually have
  // lum 20-50 AND white text).
  if (lum < 60 && container.body) {
    try {
      const bodyText = parseRgb(win.getComputedStyle(container.body).color);
      if (bodyText) {
        const textLum = 0.299 * bodyText.r + 0.587 * bodyText.g + 0.114 * bodyText.b;
        if (textLum < 120) theme = 'light';
      }
    } catch {
      /* swallow */
    }
  }
  return theme;
}

/**
 * Watch for theme changes triggered by:
 *   1. OS-level prefers-color-scheme toggle (matchMedia listener)
 *   2. Host site toggling its own theme via class / data-theme / [dark]
 *      attribute on <html> or <body> (MutationObserver, attribute-only,
 *      no subtree -- cheap)
 *   3. SPA navigation (caller invokes the returned function on each nav)
 *
 * Returns a `reapplyTheme` function the orchestrator calls inside
 * `reattach()` so theme also re-evaluates after each yt-navigate-finish.
 *
 * All listeners + observers register against ctx.cleanup so they vanish
 * on extension reload / dispose. Mirrors .user.js:1678-1750 theme-watch
 * scaffolding.
 */
export function installThemeWatcher(
  site: Site,
  ctx: AppContext,
  referenceEl: () => Element | null = () => null,
): () => void {
  // Debounce so a burst of mutations / a single click that fires multiple
  // listeners doesn't run reapply() ten times in a frame.
  let recheckTimer: ReturnType<typeof setTimeout> | null = null;
  const reapply = (): void => {
    try {
      detectAndApplyTheme(site, document, referenceEl());
    } catch (e) {
      ctx.logger.warn('theme: reapply failed', e);
    }
  };
  const scheduleRecheck = (delay = 120): void => {
    if (recheckTimer) clearTimeout(recheckTimer);
    recheckTimer = setTimeout(() => {
      recheckTimer = null;
      reapply();
    }, delay);
  };

  if (typeof window.matchMedia === 'function') {
    try {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = (): void => scheduleRecheck(100);
      mql.addEventListener('change', handler);
      ctx.cleanup.add(() => {
        try {
          mql.removeEventListener('change', handler);
        } catch {
          /* swallow */
        }
      });
    } catch {
      /* swallow -- ancient browser */
    }
  }

  // MutationObserver — watches the most common theme-toggle mechanisms:
  // class swaps (`b-body--dark` etc.), data-theme/data-color-scheme attrs,
  // inline style changes (CSS-var swap on body/html), and the legacy
  // `[dark]` boolean attribute YouTube once used.
  const themeObserver = new MutationObserver(() => scheduleRecheck(120));
  const observerConfig: MutationObserverInit = {
    attributes: true,
    attributeFilter: ['class', 'data-theme', 'data-color-scheme', 'dark', 'style'],
  };
  themeObserver.observe(document.documentElement, observerConfig);
  if (document.body) themeObserver.observe(document.body, observerConfig);
  ctx.cleanup.addObserver(themeObserver);

  // Click fallback (capture-phase). Some sites toggle theme through pure
  // JS state — they update CSS variables on a <style> element or swap
  // class on a non-watched node — and the MutationObserver above misses
  // it. After ANY click we re-check after ~250 ms so a CSS-transition
  // has time to settle. Mirrors .user.js:1719-1722.
  ctx.cleanup.addEventListener(document, 'click', () => scheduleRecheck(250), { capture: true });

  // Cold-load race fix. HDRezka applies its theme via JS that runs AFTER
  // our content script's first `injectStyles()` call — at document_idle
  // the body still inherits default light styles, so the initial detect
  // misjudges a dark-theme reload as 'light' (and persists that wrong
  // value to lastSeenTheme, which then poisons the popup).
  // We schedule deferred re-checks at progressively longer delays to
  // catch the theme as soon as the host script applies it. window.load
  // is the strongest backstop — by then all site scripts have finished.
  ctx.cleanup.setTimeout(() => scheduleRecheck(0), 200);
  ctx.cleanup.setTimeout(() => scheduleRecheck(0), 600);
  ctx.cleanup.setTimeout(() => scheduleRecheck(0), 1500);
  if (document.readyState !== 'complete') {
    const onLoad = (): void => scheduleRecheck(100);
    window.addEventListener('load', onLoad, { once: true });
    ctx.cleanup.add(() => {
      try {
        window.removeEventListener('load', onLoad);
      } catch {
        /* swallow */
      }
    });
  }

  ctx.cleanup.add(() => {
    if (recheckTimer) {
      clearTimeout(recheckTimer);
      recheckTimer = null;
    }
  });

  return reapply;
}

// Compact base ruleset with explicit theme handling.
//
// Theme is decided by detectAndApplyTheme() (called from bootstrap) which
// writes `data-vs-theme="dark"|"light"` onto `<html>`. The decision rule:
//   - RuTube: always dark (RuTube has no light mode)
//   - YouTube: read its own `[dark]` attribute, default light otherwise
// CSS keys off `data-vs-theme` so labels + slider track adapt to the
// surrounding page colour (the panel itself is transparent).
//
// Per-site accent: --vs-accent overridden via the `[data-vs-site]`
// attribute the panel itself carries (see panel.ts), so YouTube gets red
// and RuTube its blue.
const BASE_STYLES = `
/* Mono fallback chain so .vs-menu-version / .vs-hotkey-input / .vs-row-hint
   render in a monospace face matching the userscript's JetBrains Mono.
   We deliberately do NOT @import a webfont (extension policy + privacy);
   ui-monospace is an Apple/macOS alias for SF Mono, falling back to
   distros' default. */

/* Token sets per theme. Panel itself is transparent; buttons + gear get
   their own pills that ADAPT to the host page colour:
     light page  -> light pills + dark text
     dark page   -> dark pills + white text
   Slider track + label inherit --vs-text-primary so they stay readable
   on either background. Active button always uses the accent fill with
   white text (overridden inside .speed-button.active below). */
:root,
html[data-vs-theme="dark"] {
  /* HDRezka body is near-black (rgb(2,5,14)). The default 0.10 alpha
     pill background reads almost identical to the surrounding canvas;
     bump to 0.15 so non-active speed buttons are clearly visible.
     Hover bumps to 0.28 for a clear focus signal. */
  --vs-bg-button: rgba(255, 255, 255, 0.15);
  --vs-bg-button-hover: rgba(255, 255, 255, 0.28);
  --vs-button-text: rgba(255, 255, 255, 0.95);
  --vs-bg-track: rgba(255, 255, 255, 0.22);
  --vs-text-primary: rgba(255, 255, 255, 0.95);
  --vs-text-secondary: rgba(255, 255, 255, 0.72);
  --vs-text-dim: rgba(255, 255, 255, 0.60);
  --vs-border: rgba(255, 255, 255, 0.16);
  /* Default accent palette (HDRezka cyan-blue). */
  --vs-accent: #00a1db;
  --vs-accent-dark: #0080b0;
  --vs-accent-darker: #005f85;
  --vs-accent-rgb: 0, 161, 219;
  /* Settings-menu scoped tokens — translucent dark surface, white text. */
  --vs-menu-bg: rgba(20, 20, 22, 0.94);
  --vs-menu-divider: rgba(255, 255, 255, 0.06);
  --vs-menu-input-bg: rgba(255, 255, 255, 0.05);
  --vs-menu-input-border: rgba(255, 255, 255, 0.12);
  --vs-menu-button-bg: rgba(255, 255, 255, 0.06);
  --vs-menu-button-bg-hover: rgba(255, 255, 255, 0.10);
  --vs-menu-button-border: rgba(255, 255, 255, 0.10);
  --vs-menu-track-bg: rgba(255, 255, 255, 0.04);
  --vs-menu-scrollbar: rgba(255, 255, 255, 0.18);
  --vs-menu-shadow-1: 0 20px 60px -10px rgba(0, 0, 0, 0.7);
  --vs-menu-shadow-2: 0 8px 24px -6px rgba(0, 0, 0, 0.5);
  /* Active state — calmer than .speed-button.active (which uses the
     bright --vs-accent gradient): the menu can have several actives at
     once, brighter would overwhelm. Bound to the site-aware --vs-accent-*
     palette so on YouTube it's red, on RuTube it's blue. Hover deepens
     via filter:brightness so we don't need a separate per-site hover
     gradient. */
  --vs-menu-active-bg: linear-gradient(135deg, var(--vs-accent-dark) 0%, var(--vs-accent-darker) 100%);
  --vs-menu-active-fg: #ffffff;
  --vs-menu-active-glow: 0 2px 10px rgba(var(--vs-accent-rgb), 0.35);
  --vs-menu-active-glow-hover: 0 3px 14px rgba(var(--vs-accent-rgb), 0.5);
  /* Toggle ON — site-aware accent. */
  --vs-toggle-on: var(--vs-accent-dark);
}
html[data-vs-theme="light"] {
  --vs-bg-button: rgba(0, 0, 0, 0.06);
  --vs-bg-button-hover: rgba(0, 0, 0, 0.12);
  --vs-button-text: rgba(15, 15, 15, 0.88);
  --vs-bg-track: rgba(0, 0, 0, 0.15);
  --vs-text-primary: rgba(15, 15, 15, 0.92);
  --vs-text-secondary: rgba(15, 15, 15, 0.66);
  --vs-text-dim: rgba(15, 15, 15, 0.55);
  --vs-border: rgba(0, 0, 0, 0.10);
  --vs-accent: #00a1db;
  --vs-accent-dark: #0080b0;
  --vs-accent-darker: #005f85;
  --vs-accent-rgb: 0, 161, 219;
  /* Settings-menu scoped tokens — light translucent surface, dark text. */
  --vs-menu-bg: rgba(248, 248, 250, 0.97);
  --vs-menu-divider: rgba(0, 0, 0, 0.06);
  --vs-menu-input-bg: rgba(0, 0, 0, 0.04);
  --vs-menu-input-border: rgba(0, 0, 0, 0.12);
  --vs-menu-button-bg: rgba(0, 0, 0, 0.05);
  --vs-menu-button-bg-hover: rgba(0, 0, 0, 0.09);
  --vs-menu-button-border: rgba(0, 0, 0, 0.12);
  --vs-menu-track-bg: rgba(0, 0, 0, 0.05);
  --vs-menu-scrollbar: rgba(0, 0, 0, 0.20);
  --vs-menu-shadow-1: 0 20px 60px -10px rgba(0, 0, 0, 0.18);
  --vs-menu-shadow-2: 0 8px 24px -6px rgba(0, 0, 0, 0.10);
  /* Same site-aware gradient on light theme. White on #cc0000 gives
     5.89:1, on #0086c4 gives 4.78:1 — both AA pass. */
  --vs-menu-active-bg: linear-gradient(135deg, var(--vs-accent-dark) 0%, var(--vs-accent-darker) 100%);
  --vs-menu-active-fg: #ffffff;
  --vs-menu-active-glow: 0 2px 10px rgba(var(--vs-accent-rgb), 0.35);
  --vs-menu-active-glow-hover: 0 3px 14px rgba(var(--vs-accent-rgb), 0.5);
  --vs-toggle-on: var(--vs-accent-dark);
}

/* Per-site accent. Single supported site here (HDRezka), but we keep the
   data-vs-site selector for parity with the multi-site VideoSpeeds project
   in case a future build adds more sites. */
.vs-panel[data-vs-site="hdrezka"],
html[data-vs-site="hdrezka"] { --vs-accent: #00a1db; --vs-accent-dark: #0080b0; --vs-accent-darker: #005f85; --vs-accent-rgb: 0,161,219; }

/* The panel: TRANSPARENT flex row attached just below the player. No
   capsule background -- buttons and the gear handle their own visual
   weight so the row blends with whatever surface YouTube/RuTube paints
   (matches the original userscript layout). */
@keyframes vs-fade-in {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}
/* Settings modal open animation. Mirrors .user.js:3061-3066 vs-menu-in. */
@keyframes vs-menu-in {
  from { opacity: 0; transform: translateY(-6px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
/* Tab-panel cross-fade on tab switch. Mirrors .user.js:3199-3203 vs-panel-in. */
@keyframes vs-panel-in {
  from { opacity: 0; transform: translateY(2px); }
  to   { opacity: 1; transform: translateY(0); }
}
/* Yellow status halo while diagnostics still inconclusive. */
@keyframes vs-status-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255,152,0,0.5); }
  50%      { box-shadow: 0 0 0 6px rgba(255,152,0,0); }
}
/* Hotkey-input pulsing accent ring while waiting for the user's keypress. */
@keyframes vs-capture-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(var(--vs-accent-rgb), 0.5); }
  50%      { box-shadow: 0 0 0 4px rgba(var(--vs-accent-rgb), 0); }
}
.vs-panel {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0;
  /* Auto horizontal margins center the panel within its parent column. On
     YouTube's narrow-viewport layout (parent retains a desktop min-width
     wider than the visual viewport) this lets the spare horizontal room
     redistribute equally on both sides, so the buttons don't visually
     hug the left edge while leaving an empty stripe on the right. */
  margin: 12px auto;
  width: 100%;
  /* Cap to viewport so the host page's primary column (e.g. YouTube's
     #primary-inner) cannot push us past the screen edges on narrow
     widths -- without this our buttons overflow ±26px on a 375px
     viewport because the parent retains a desktop min-width. */
  max-width: 100vw;
  box-sizing: border-box;
  background: transparent;
  border: none;
  font-family: 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: var(--vs-text-primary);
  /* No z-index on purpose: it would create a stacking context that traps
     the settings modal (child) under host-page elements with a higher
     z-index in the document context (YouTube comments header, RuTube
     sidebar). The gear-wrapper still has position:relative so the modal
     can anchor to it. */
  position: static;
  animation: vs-fade-in 0.3s ease;
}

/* sliderPosition='bottom' -- buttons + gear share the top row; slider
   takes its own row below them. Mirrors .user.js:2873-2877 layout-bottom
   where wrapperDiv (buttons + settings) sat above sliderContainer.
   Implemented as CSS-grid so we don't have to wrap the buttons + gear
   in a real DOM container -- the panel root keeps its three flat
   children for easy detach in 'video' mode. */
.vs-panel[data-vs-slider-position="bottom"] {
  display: grid;
  grid-template-columns: auto auto 1fr;
  /* Slider spans only the first 2 columns (buttons + gear). The 3rd
     1fr column soaks up trailing space and the slider intentionally
     does NOT extend into it — keeps the second-row width visually
     aligned with the buttons-and-gear group above it. */
  grid-template-areas:
    "buttons gear   ."
    "slider  slider .";
  align-items: center;
  gap: 12px 12px;
}
.vs-panel[data-vs-slider-position="bottom"] .speed-buttons-row {
  grid-area: buttons;
  flex-wrap: wrap;
}
/* gear sits flush against the buttons (column 2). Column 3 = 1fr soaks
   up the remaining horizontal space — without it, justify-self: end
   would push the gear to the far right edge of the panel and leave a
   visual chasm between the buttons and the gear. */
.vs-panel[data-vs-slider-position="bottom"] .vs-gear-wrapper {
  grid-area: gear;
  justify-self: start;
}
/* In bottom layout the slider stretches across cols 1+2 (= buttons +
   gear width), so override the default fixed width / max-width that
   the right-layout slider needs (300px cap). */
.vs-panel[data-vs-slider-position="bottom"] .speed-slider-container {
  grid-area: slider;
  width: auto;
  max-width: none;
  flex: 0 0 auto;
}

/* sliderPosition='video' -- ONLY the slider container is detached from
   the panel and re-parented into player chrome (.ytp-right-controls on
   YouTube, the desktop-controls column on RuTube). Mirrors original
   .user.js:4884-4892 + integrateVideoSlider. The buttons + gear stay
   in their normal anchor between the player and the metadata block.
   The .vs-slider-in-chrome class is added by panel.applyLayout() when
   the slider sits inside chrome, so we can size it appropriately
   without bleeding into the in-panel slider styles.

   When the slider is gone, the panel renders as [buttons] [gear] --
   no extra rules needed; flex naturally collapses the gap. */
.speed-slider-container.vs-slider-in-chrome {
  flex: 0 0 auto;
  width: 200px;             /* match userscript .video-slider-container .speed-slider-container width=200 */
  min-width: 140px;
  height: 40px;
  padding: 0 4px;
  margin: 0 6px;
  align-self: center;
  order: -1;                 /* push to leftmost position inside .ytp-right-controls (parity .user.js:3761) */
  --vs-text-primary: rgba(255, 255, 255, 0.95);
  --vs-bg-track: rgba(255, 255, 255, 0.22);
}
/* Video-mode label sits to the LEFT of the slider, always visible
   (mirror .user.js:.video-speed-label at 3794-3802). The static label
   is hidden in panel layouts (right/bottom) where the floating
   .speed-value tooltip plays the same role on hover. */
.speed-slider-container.vs-slider-in-chrome .speed-slider-label {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: flex-start !important;
  height: 100% !important;
  line-height: 1 !important;
  font-size: 12px !important;
  font-weight: 400 !important;
  min-width: 36px !important;
  margin: 0 4px 0 0 !important;
  padding: 0 !important;
  vertical-align: middle !important;
  text-align: left !important;
  color: rgba(255,255,255,0.8) !important;
}
.speed-slider-container.vs-slider-in-chrome .speed-slider {
  align-self: center;
  height: 3px;
  margin: 0 !important;
  padding: 0 !important;
}
/* Hide the floating tooltip in chrome layout — the static left label
   is always-on, so a tooltip on top of it would be redundant. */
.speed-slider-container.vs-slider-in-chrome .speed-value {
  display: none !important;
}

/* Plyr controls auto-hide integration: chrome-mounted slider fades with
   the rest of the player chrome. Plyr toggles .plyr--hide-controls on
   the player root after the inactivity delay. */
.plyr .speed-slider-container.vs-slider-in-chrome {
  opacity: 1;
  transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.plyr.plyr--hide-controls .speed-slider-container.vs-slider-in-chrome {
  opacity: 0;
  pointer-events: none;
}

/* Speed-button row: pill buttons. min-width keeps every label centred
   even when the text varies (1x vs 1.25x); height fixed so the row is
   visually stable. Ported from .user.js:.speed-button. */
.vs-brand {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-right: 2px;
  opacity: 0.5;
  color: var(--vs-accent, currentColor);
  transition: opacity 0.15s ease;
  flex-shrink: 0;
  cursor: default;
  pointer-events: auto;
}
.vs-brand:hover { opacity: 0.85; }
.speed-buttons-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
  flex-shrink: 0;
  /* Subtle surface so the pill row reads as a unit rather than as
     pills "floating in the air" on near-black HDRezka backgrounds
     (audit MAJ-13). The light-theme override below softens it. */
  background: rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-radius: 18px;
  padding: 4px 6px;
}
html[data-vs-theme="light"] .speed-buttons-row {
  background: rgba(255, 255, 255, 0.55);
}
/* Pinned (saved/default) speed indicator: bookmark icon top-right +
   soft accent halo glow around the button. Replaces the earlier 5×5
   dot (audit 2026-05-09: dot was uninformative, didn't read as
   "saved"). The bookmark uses mask-image so the colour comes from
   --vs-accent (per-site palette) without hard-coding hex per build.
   The halo glow is the primary peripheral-vision signal — even at a
   glance the pinned button reads as "warmer" than its neighbours. */
.speed-button.pinned {
  box-shadow: 0 0 18px 3px rgba(var(--vs-accent-rgb), 0.45);
}
.speed-button.pinned.active {
  box-shadow:
    0 2px 10px rgba(var(--vs-accent-rgb), 0.35),
    0 0 22px 5px rgba(var(--vs-accent-rgb), 0.55);
}
.speed-button.pinned.active:hover {
  box-shadow:
    0 3px 14px rgba(var(--vs-accent-rgb), 0.5),
    0 0 26px 6px rgba(var(--vs-accent-rgb), 0.6);
}
.speed-button.pinned::after {
  content: '';
  position: absolute;
  top: 2px;
  right: 7px;
  width: 7px;
  height: 11px;
  background-color: var(--vs-accent);
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 24'%3E%3Cpath fill='white' d='M2 1h12v22l-6-5-6 5z'/%3E%3C/svg%3E");
          mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 24'%3E%3Cpath fill='white' d='M2 1h12v22l-6-5-6 5z'/%3E%3C/svg%3E");
  -webkit-mask-size: contain;
          mask-size: contain;
  -webkit-mask-repeat: no-repeat;
          mask-repeat: no-repeat;
  pointer-events: none;
}
.speed-button.pinned.active::after {
  /* On the active gradient the accent-on-accent icon would disappear;
     switch to white so the bookmark stays readable. */
  background-color: #fff;
}
.speed-button {
  position: relative;
  min-width: 56px;
  height: 28px;
  padding: 0 14px;
  /* 1px translucent border so the pill outline survives on near-black
     surfaces like HDRezka's body. The active state below resets to
     transparent — the gradient + accent shadow already provide enough
     visual weight without a competing border. */
  border: 1px solid var(--vs-border);
  outline: none;
  border-radius: 14px;
  background: var(--vs-bg-button);
  color: var(--vs-button-text);
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.05px;
  font-variant-numeric: tabular-nums;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s ease, color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
  user-select: none;
  overflow: hidden;
}
.speed-button:hover {
  background: var(--vs-bg-button-hover);
  color: var(--vs-button-text);
  transform: translateY(-1px);
}
.speed-button.active {
  background: linear-gradient(135deg, var(--vs-accent) 0%, var(--vs-accent-dark) 100%);
  color: #fff;
  font-weight: 600;
  border-color: transparent;
  box-shadow: 0 2px 10px rgba(var(--vs-accent-rgb), 0.35);
}
.speed-button.active:hover {
  /* 3-step gradient on hover: accent-dark -> accent-darker (mirrors
     .user.js where hover deepens the gradient instead of just swapping
     base/dark). Falls back gracefully when --vs-accent-darker is undefined
     (uses --vs-accent-dark twice). */
  background: linear-gradient(135deg, var(--vs-accent-dark) 0%, var(--vs-accent-darker, var(--vs-accent-dark)) 100%);
  box-shadow: 0 3px 14px rgba(var(--vs-accent-rgb), 0.5);
}

/* Click ripple -- radial-gradient that grows from centre. */
.speed-button::before {
  position: absolute;
  content: "";
  top: 0; left: 0;
  width: 100%;
  height: 100%;
  background: radial-gradient(circle, rgba(255,255,255,0.3) 0%, transparent 70%);
  transform: scale(0);
  opacity: 0;
  transition: transform 0.4s ease;
  pointer-events: none;
}
.speed-button:active::before {
  transform: scale(2);
  opacity: 1;
  transition: 0s;
}

/* Slider sits between the buttons and the gear. The original userscript
   used a 300px container; we let it stretch on the modern wide YouTube
   layout (flex: 1) but keep a min-width so it doesn't collapse. Thumb
   is white (matches video-player ergonomics) with the accent fill on
   the track. */
.speed-slider-container {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 4px;
  /* Preferred width 300px (parity with userscript). flex-grow: 0 stops
     the slider from stretching into the recommendations column on wide
     viewports; flex-shrink: 1 lets it collapse below 300px when the
     buttons-row + gear + 300px slider would overflow a narrow parent
     (player-width column). min-width 100px keeps the thumb usable. */
  flex: 0 1 300px;
  min-width: 100px;
  max-width: 300px;
  height: 32px;
  position: relative;
}
.speed-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  flex: 1 1 auto;
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(
    to right,
    var(--vs-accent) 0%,
    var(--vs-accent) var(--vs-slider-fill, 0%),
    var(--vs-bg-track) var(--vs-slider-fill, 0%),
    var(--vs-bg-track) 100%
  );
  outline: none;
  cursor: pointer;
  margin: 0;
  transition: height 0.15s ease;
}
.speed-slider-container:hover .speed-slider { height: 6px; }
.speed-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  border: none;
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(0,0,0,0.5);
  transition: transform 0.15s ease;
}
.speed-slider-container:hover .speed-slider::-webkit-slider-thumb {
  transform: scale(1.4);
}
.speed-slider::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  border: none;
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(0,0,0,0.5);
}
.speed-slider-container:hover .speed-slider::-moz-range-thumb {
  transform: scale(1.4);
}
/* Static left-of-slider label. Hidden by default; only shown when the
   slider is mounted into player chrome (vs-slider-in-chrome). In panel
   layouts the floating .speed-value tooltip below takes its place. */
.speed-slider-label {
  display: none;
  min-width: 36px;
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  font-weight: 600;
  color: var(--vs-text-primary);
  text-align: left;
  flex-shrink: 0;
}

/* Floating tooltip above the slider thumb. Hidden at rest, revealed on
   container :hover or while the thumb is :active (drag). The active
   speed-button in the buttons row already shows the current speed, so
   a permanent tooltip duplicated that information AND poked above the
   slider container into the video frame (audit 2026-05-09). The CRIT-2
   readability concern is solved by the active button's value display.
   Slides horizontally via inline style.left set by updateSliderFill
   (in slider.ts). */
.speed-value {
  position: absolute;
  bottom: 32px;
  background: rgba(28, 28, 28, 0.92);
  color: #fff;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.2s ease, left 0.1s ease, transform 0.2s ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  transform: translateX(-50%) scale(0.85);
  font-variant-numeric: tabular-nums;
}
.speed-value::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-top: 5px solid rgba(28, 28, 28, 0.92);
}
.speed-slider-container:hover .speed-value,
.speed-slider:active ~ .speed-value {
  opacity: 1;
  transform: translateX(-50%) scale(1);
}
/* YouTube light-theme background for popup tooltip. */
html[data-vs-theme="light"] .speed-value {
  background: rgba(255, 255, 255, 0.96);
  color: rgba(15, 15, 15, 0.92);
}
html[data-vs-theme="light"] .speed-value::after {
  border-top-color: rgba(255, 255, 255, 0.96);
}

/* Gear -- circular icon button. Matches the original userscript
   .settings-button (28x28 circle, 16px SVG, rotates 60deg on hover). */
.vs-gear-wrapper {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
}
.vs-gear-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  background: var(--vs-bg-button);
  color: var(--vs-button-text);
  cursor: pointer;
  transition: background-color 0.2s ease, color 0.2s ease;
}
.vs-gear-button svg {
  width: 16px;
  height: 16px;
  transition: transform 0.3s ease;
}
.vs-gear-button:hover {
  background: var(--vs-bg-button-hover);
  color: var(--vs-button-text);
}
.vs-gear-button:hover svg {
  transform: rotate(60deg);
}

/* Health-warning dot: pulsing red marker on the gear when the
   diagnostic checker reports an unhealthy state. Toggle via the
   has-warning class (Wave 1.9 wires this up). */
.vs-gear-button.has-warning::after {
  content: '';
  position: absolute;
  top: -2px;
  right: -2px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f44336;
  box-shadow: 0 0 4px rgba(244, 67, 54, 0.7);
  animation: vs-warning-pulse 2s infinite;
  pointer-events: none;
}
@keyframes vs-warning-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.45; }
}

/* In-player speed popup. Anchored to the upper-right of the player
   container (parity .user.js:3888-3916) — looks like a native YouTube
   volume / chapter indicator instead of covering the centre of the
   video. Per-site sizing: YouTube renders bigger + softer drop-shadow,
   RuTube smaller. Light theme inverts text to black (YouTube-only —
   RuTube has no light mode). */
#speed-popup.speed-popup {
  position: absolute;
  top: 50%;
  right: 20px;
  left: auto;
  transform: translateY(-50%);
  background: rgba(0, 0, 0, 0.8);
  color: #fff;
  font-size: 16px;
  font-weight: normal;
  padding: 10px 15px;
  border-radius: 5px;
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
  z-index: 100000;
  font-family: 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-variant-numeric: tabular-nums;
}
#speed-popup.speed-popup[data-vs-site="hdrezka"] {
  font-size: 18px;
  font-weight: 600;
  padding: 10px 18px;
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}
html[data-vs-theme="light"] #speed-popup.speed-popup[data-vs-site="hdrezka"] {
  color: black;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
}
#speed-popup.speed-popup.show { opacity: 1; }

/* Settings modal -- glassmorphic floating popover (parity
   .user.js:3019-3066). Dark translucent fill + backdrop-filter blur so
   the modal feels lifted above the player chrome instead of pasted on.
   Header / tabs / panels manage their own padding (matches the
   original's padding:0 on the root). The z-index matches the
   userscript -- 999999 is high enough to clear YouTube's masthead /
   comments header which use z-indices up to ~100000. */
.settings-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  /* Surface adapts to the host page theme via --vs-menu-* tokens defined
     at html[data-vs-theme="dark|light"]. No local hardcoded values so the
     modal matches whichever YouTube theme the user has chosen. */
  background: var(--vs-menu-bg);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  backdrop-filter: blur(24px) saturate(180%);
  color: var(--vs-text-primary);
  border-radius: 14px;
  padding: 0;
  width: 380px;
  max-width: calc(100vw - 24px);
  max-height: calc(100vh - 80px);
  border: 1px solid var(--vs-border);
  box-shadow: var(--vs-menu-shadow-1), var(--vs-menu-shadow-2);
  z-index: 999999;
  display: none;
  /* Internal vertical scroll engages once panel.ts caps max-height for a
     viewport that can't fit the natural modal height. Horizontal stays
     clipped so a wide row never escapes the rounded corners. */
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--vs-menu-scrollbar) transparent;
  font-family: 'Inter Tight', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.settings-menu::-webkit-scrollbar {
  width: 6px;
}
.settings-menu::-webkit-scrollbar-thumb {
  background: var(--vs-menu-scrollbar);
  border-radius: 3px;
}
.settings-menu.show {
  display: flex;
  flex-direction: column;
  animation: vs-menu-in 180ms cubic-bezier(0.16, 1, 0.3, 1);
}
.settings-menu[data-vs-flip="left"] {
  right: auto;
  left: 0;
}
/* Vertical flip: when the gear sits in the lower half of the viewport and
   the modal would overflow the bottom edge, panel.ts toggles this attr so
   the modal opens UPWARD (anchored to the gear's TOP edge). Mirrors the
   "popover smart-positioning" pattern. */
.settings-menu[data-vs-flip-y="up"] {
  top: auto;
  bottom: calc(100% + 6px);
}

/* SVG protection: YouTube/RuTube ship global SVG rules (transform on
   hover, fill/stroke overrides) that mangle our Lucide stroked icons.
   Reset them inside our scoped UI roots only. Ported from
   .user.js:3071-3082.

   The [data-filled] exclusion lets vsFilledGearIcon (icons.ts) ship
   a Material-style filled cog without the protection rule blanking it
   out. */
.vs-panel svg:not([data-filled]),
.settings-menu svg:not([data-filled]) {
  transform: none !important;
  fill: none !important;
  stroke: currentColor !important;
  vertical-align: middle;
  flex-shrink: 0;
}
.vs-panel svg:not([data-filled]) *,
.settings-menu svg:not([data-filled]) * {
  fill: none !important;
  stroke: currentColor !important;
  transform: none !important;
}
/* Filled icons keep the explicit fill="currentColor" (set on the SVG
   itself in icons.ts) and reset stroke. */
.vs-panel svg[data-filled],
.settings-menu svg[data-filled] {
  fill: currentColor !important;
  stroke: none !important;
  vertical-align: middle;
  flex-shrink: 0;
}
.vs-panel svg[data-filled] *,
.settings-menu svg[data-filled] * {
  fill: currentColor !important;
  stroke: none !important;
}
/* Header bar: padded + bottom border separating it from the tabs
   container (parity .user.js:3084-3114). */
.vs-menu-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--vs-menu-divider);
  flex-shrink: 0;
}
.vs-menu-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--vs-text-primary);
}
.vs-menu-title svg {
  width: 14px;
  height: 14px;
  color: var(--vs-accent, #ff0000);
  opacity: 0.9;
}
/* Help icon in the modal header — opens welcome.html in a new tab. */
.vs-menu-help {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: auto;
  padding: 4px;
  border-radius: 6px;
  color: var(--vs-text-secondary);
  text-decoration: none;
  transition: color 140ms ease, background 140ms ease;
}
.vs-menu-help:hover {
  color: var(--vs-text-primary);
  background: var(--vs-menu-button-bg-hover);
}
.vs-menu-version {
  font-size: 10px;
  font-weight: 500;
  color: var(--vs-text-dim);
  font-family: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  letter-spacing: 0;
}

/* Tabs row — underline idiom (user-decided in audit hybrid choice).
   Per-tab padding/transitions match userscript timing (160ms). */
.vs-tabs {
  display: flex;
  gap: 4px;
  margin: 10px 12px 0;
  border-bottom: 1px solid var(--vs-menu-divider);
  flex-shrink: 0;
}
.vs-tab {
  padding: 6px 6px;
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  opacity: 0.55;
  font-size: 12px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  /* flex: 1 1 0 distributes the tab strip width evenly across the
     four tabs; min-width:0 + overflow:hidden lets text crop cleanly
     instead of spilling past the flex-box. The active-state
     border-bottom now matches the visible tab width, so the
     underline reads correctly under the label even on narrow popups
     where four-tab layout would otherwise overflow the 340px / 380px
     menu frame. */
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  transition: color 160ms ease, opacity 160ms ease, border-color 160ms ease;
}
.vs-tab:hover { opacity: 0.85; }
.vs-tab[aria-selected="true"] {
  opacity: 1;
  /* Bold-weight + accent underline. Earlier the only signal was the
     1px accent underline + opacity diff — not a strong enough non-
     colour cue (audit MAJ-8). Bold makes the active tab readable
     even in deuteranopia simulation. */
  font-weight: 700;
  border-bottom: 2px solid var(--vs-accent, #ff0000);
}
.vs-tab[aria-selected="true"] svg { color: var(--vs-accent, #ff0000); }

/* Tab panel — fade-in on switch, scrollable when tall, custom scrollbar.
   overflow-x: hidden defends against any child whose intrinsic width
   pushes past the menu fixed 340px frame (e.g. a long crypto address
   that the wrapping logic has not applied yet). Without it, the menu
   would grow a horizontal scrollbar mid-tab-switch. */
.vs-tab-panel {
  padding: 10px 16px 14px;
  max-height: 60vh;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: var(--vs-menu-scrollbar) transparent;
  animation: vs-panel-in 160ms ease-out;
}
.vs-tab-panel::-webkit-scrollbar { width: 6px; }
.vs-tab-panel::-webkit-scrollbar-track { background: transparent; }
.vs-tab-panel::-webkit-scrollbar-thumb {
  background: var(--vs-menu-scrollbar);
  border-radius: 3px;
}
.vs-tab-panel[aria-hidden="true"] { display: none; }

.vs-section { margin-bottom: 18px; }
.vs-section + .vs-section { margin-top: 18px; }
.vs-section-label {
  font-size: 10px;
  /* Bumped from 0.7 to 0.85 for WCAG AA compliance on small uppercase
     text — at 10px we need >=4.5:1 since it's not "large text". */
  opacity: 0.85;
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
}

/* Segmented control: pill row inside a translucent track. Active option
   gets accent-tinted background + inset accent ring + accent SVG. */
.vs-segmented {
  display: flex;
  gap: 2px;
  background: var(--vs-menu-track-bg);
  border-radius: 9px;
  padding: 4px;
}
.vs-segmented-option {
  flex: 1;
  padding: 0 8px;
  height: 28px;
  background: transparent;
  border: none;
  color: var(--vs-text-secondary);
  cursor: pointer;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 500;
  transition: color 140ms ease, background 140ms ease;
}
.vs-segmented-option:hover { color: var(--vs-text-primary); }
.vs-segmented-option[aria-pressed="true"] {
  background: var(--vs-menu-active-bg);
  color: var(--vs-menu-active-fg);
  box-shadow: var(--vs-menu-active-glow);
  font-weight: 600;
}
.vs-segmented-option[aria-pressed="true"]:hover {
  filter: brightness(0.9);
  box-shadow: var(--vs-menu-active-glow-hover);
}
.vs-segmented-option[aria-pressed="true"] svg { color: var(--vs-accent, #ff0000); }

/* Speed-preset toggle grid in the General tab. Each pill represents one
   value from SPEED_POOL filtered to the site's bounds. v0.3.5 audit
   MAJ-11 split the flat 14-18 pill grid into three labelled groups
   ("Slower than 1×", "1× – 2×", "Faster than 2×") so the wall isn't
   intimidating to casual users. */
.vs-preset-group { margin: 6px 0 10px; }
.vs-preset-group:last-of-type { margin-bottom: 4px; }
.vs-preset-group-label {
  font-size: 11px;
  font-weight: 600;
  opacity: 0.65;
  letter-spacing: 0.02em;
  margin-bottom: 5px;
  color: var(--vs-text-secondary);
}
.vs-preset-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
}
.vs-preset-pill {
  flex: 0 0 auto;
  min-width: 52px;
  padding: 6px 10px;
  background: var(--vs-menu-button-bg);
  border: 1px solid transparent;
  border-radius: 999px;
  color: var(--vs-text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease, transform 140ms ease, box-shadow 140ms ease;
}
.vs-preset-pill:hover {
  color: var(--vs-text-primary);
  background: var(--vs-menu-button-bg-hover);
  transform: translateY(-1px);
}
.vs-preset-pill.active {
  background: var(--vs-menu-active-bg);
  border-color: transparent;
  color: var(--vs-menu-active-fg);
  font-weight: 600;
  box-shadow: var(--vs-menu-active-glow);
}
.vs-preset-pill.active:hover {
  filter: brightness(0.9);
  box-shadow: var(--vs-menu-active-glow-hover);
}

/* Slider-range row — two number inputs (Min, Max) for the in-player
   speed slider override. Empty = "use site default". */
.vs-slider-range-row {
  display: flex;
  gap: 12px;
  align-items: stretch;
  margin-top: 6px;
}
.vs-slider-range-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}
.vs-slider-range-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--vs-text-secondary);
}
.vs-slider-range-input {
  padding: 6px 10px;
  background: var(--vs-menu-input-bg);
  border: 1px solid var(--vs-menu-input-border);
  border-radius: 8px;
  color: var(--vs-text-primary);
  font: inherit;
  font-size: 13px;
  -moz-appearance: textfield;
}
.vs-slider-range-input:focus {
  outline: none;
  border-color: rgba(var(--vs-accent-rgb, 255, 0, 0), 0.55);
  background: var(--vs-menu-button-bg-hover);
}
.vs-slider-range-input::-webkit-inner-spin-button,
.vs-slider-range-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

/* Custom speed input row — sits under the pool grid + above the
   "Reset to defaults" link. Lets a power user type any 0.5x-10x value
   that is not in the conventional pool. Enter or click "+ Add". */
.vs-preset-custom-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 10px;
}
.vs-preset-custom-input {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  background: var(--vs-menu-input-bg);
  border: 1px solid var(--vs-menu-input-border);
  border-radius: 8px;
  color: var(--vs-text-primary);
  font: inherit;
  font-size: 13px;
}
.vs-preset-custom-input:focus {
  outline: none;
  border-color: rgba(var(--vs-accent-rgb, 255, 0, 0), 0.55);
  background: var(--vs-menu-button-bg-hover);
}
/* Hide the native number-input spinner — distracting alongside our
   accent-tinted Add button. Users still get the keyboard up/down arrows
   for nudging the value. */
.vs-preset-custom-input::-webkit-inner-spin-button,
.vs-preset-custom-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.vs-preset-custom-input { -moz-appearance: textfield; }
.vs-preset-custom-add {
  flex-shrink: 0;
  padding: 6px 14px;
  background: var(--vs-menu-active-bg);
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--vs-menu-active-fg);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: var(--vs-menu-active-glow);
  transition: background 140ms ease, box-shadow 140ms ease, transform 140ms ease;
}
.vs-preset-custom-add:hover {
  filter: brightness(0.9);
  box-shadow: var(--vs-menu-active-glow-hover);
  transform: translateY(-1px);
}

.vs-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  cursor: pointer;
}
.vs-row-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
.vs-row-hint {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--vs-menu-button-bg-hover);
  color: var(--vs-text-secondary);
  font-family: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 9px;
  cursor: help;
  transition: background 140ms ease, color 140ms ease;
}
.vs-row-hint:hover {
  background: rgba(var(--vs-accent-rgb, 255, 0, 0), 0.25);
  color: var(--vs-accent, #ff0000);
}

/* Toggle switch with spring transition on the thumb (parity
   .user.js:.vs-toggle-thumb). */
.vs-toggle { position: relative; display: inline-block; width: 32px; height: 18px; }
.vs-toggle input { opacity: 0; width: 0; height: 0; }
.vs-toggle-track {
  position: absolute;
  inset: 0;
  background: var(--vs-bg-track);
  border-radius: 10px;
  transition: background 180ms ease;
}
.vs-toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  background: #fff;
  border-radius: 50%;
  transition: left 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
.vs-toggle input:checked + .vs-toggle-track { background: var(--vs-toggle-on, #cc0000); }
.vs-toggle input:checked ~ .vs-toggle-thumb { left: 16px; }

.vs-help-text { font-size: 12px; opacity: 0.85; margin: 6px 0 12px; line-height: 1.4; }

.vs-hotkey-block {
  padding: 8px 0;
  border-bottom: 1px solid var(--vs-menu-divider);
}
.vs-hotkey-block:last-child { border-bottom: none; }
.vs-hotkey-block-title {
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 6px;
}
.vs-hotkey-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.vs-hotkey-row { display: flex; gap: 4px; }
.vs-hotkey-input {
  flex: 1;
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid var(--vs-menu-input-border);
  background: var(--vs-menu-input-bg);
  color: var(--vs-text-primary);
  font-family: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
  cursor: pointer;
  transition: border-color 140ms ease, background 140ms ease, box-shadow 140ms ease;
}
.vs-hotkey-input:focus {
  border-color: var(--vs-accent, #ff0000);
  outline: none;
  background: var(--vs-menu-button-bg-hover);
}
.vs-hotkey-input.capturing,
.vs-hotkey-input:focus.capturing {
  border-color: var(--vs-accent, #ff0000);
  background: rgba(var(--vs-accent-rgb, 255, 0, 0), 0.08);
  animation: vs-capture-pulse 1.4s ease-in-out infinite;
}

.vs-icon-button {
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 140ms ease, color 140ms ease;
}
.vs-icon-button:hover { background: var(--vs-menu-button-bg-hover); }
.vs-icon-button.danger { color: #f44336; }
.vs-icon-button.danger:hover {
  background: rgba(239, 68, 68, 0.12);
  color: #fca5a5;
}

.vs-add-button {
  margin-top: 6px;
  padding: 4px 8px;
  background: transparent;
  border: 1px dashed var(--vs-menu-input-border);
  border-radius: 4px;
  color: var(--vs-text-primary);
  cursor: pointer;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: border-style 140ms ease, border-color 140ms ease, background 140ms ease;
}
.vs-add-button:hover {
  border-style: solid;
  border-color: var(--vs-menu-button-border);
  background: var(--vs-menu-track-bg);
}
.vs-reset-link {
  display: inline-block;
  margin-top: 4px;
  background: transparent;
  border: none;
  color: inherit;
  opacity: 0.6;
  cursor: pointer;
  font-size: 11px;
  text-decoration: underline;
  transition: opacity 140ms ease;
}
.vs-reset-link:hover { opacity: 0.95; }

.vs-status {
  display: flex;
  gap: 8px;
  padding: 10px;
  border-radius: 6px;
  background: var(--vs-menu-button-bg);
  margin-bottom: 8px;
}
.vs-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #999;
  margin-top: 4px;
  flex-shrink: 0;
}
.vs-status[data-state="ok"]      .vs-status-dot { background: #4CAF50; }
.vs-status[data-state="warn"]    .vs-status-dot { background: #ff9800; animation: vs-status-pulse 2s ease-in-out infinite; }
.vs-status[data-state="waiting"] .vs-status-dot { background: #2196F3; }
.vs-status-headline { font-size: 13px; font-weight: 500; margin-bottom: 2px; }
.vs-status-detail   { font-size: 11px; opacity: 0.7; white-space: pre-line; }

.vs-action-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-bottom: 8px;
}
.vs-action {
  padding: 6px 10px;
  background: var(--vs-menu-button-bg-hover);
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--vs-text-primary);
  cursor: pointer;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
}
.vs-action:hover {
  background: var(--vs-menu-button-bg-hover);
  filter: brightness(1.1);
}
.vs-action.danger { color: #f44336; }
.vs-action.danger:hover {
  background: rgba(239, 68, 68, 0.10);
  border-color: rgba(239, 68, 68, 0.35);
  color: #fca5a5;
}
.vs-action.danger:hover svg { color: #f87171; }

/* Large "talk to the author" CTA shown at the bottom of the General
   tab. The same feedback affordance also lives in the Diagnostics
   action grid (small button, for users already exploring tooling)
   and as a row in the Support tab — three placements, all bound to
   data-vs-diag="feedback" so the handler stays single-source. The
   General-tab CTA is the visually prominent one because that's where
   regular users land first. */
.vs-feedback-cta {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  margin-top: 14px;
  padding: 12px 16px;
  background: linear-gradient(135deg, var(--vs-accent) 0%, var(--vs-accent-dark) 100%);
  border: 1px solid transparent;
  border-radius: 10px;
  color: #fff;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(var(--vs-accent-rgb), 0.3);
  transition: transform 140ms ease, box-shadow 140ms ease, filter 140ms ease;
}
.vs-feedback-cta:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(var(--vs-accent-rgb), 0.45);
  filter: brightness(1.05);
}
.vs-feedback-cta svg { color: #fff; }

.vs-privacy-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  opacity: 0.6;
  color: var(--vs-text-secondary);
  padding: 8px 16px 12px;
  border-top: 1px solid var(--vs-menu-divider);
}

/* Donate tab — its own dedicated 4th tab so users actually find it.
   Compact two-line rows: title on the left, descriptor on the right
   (similar to iOS Settings). Crypto rows expand inline to reveal the
   wallet link + address + icon-only copy button. */
.vs-tab.vs-tab-donate svg { color: #ff6e87; }
.vs-tab.vs-tab-donate[aria-selected="true"] svg {
  color: #ff4870;
  fill: rgba(255, 72, 112, 0.18);
}

.vs-donate-content { padding: 4px 0; }
.vs-donate-intro {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.45;
  opacity: 0.78;
}

/* Two-line iOS-Settings-like row used by CloudTips link AND by each
   crypto toggle. Title bold on top, descriptor smaller/dimmer below.
   External-link icon (CloudTips) or chevron (crypto) on the right.
   Stack column has min-width:0 so long descriptors can ellipsize
   instead of pushing the icon off-screen.

   box-sizing border-box is essential here — without it, button and
   anchor elements compute their 100% width DIFFERENTLY (button defaults
   to content-box in Chromium), so the CloudTips link visually rendered
   wider than the crypto toggles. */
.vs-donate-cloudtips,
.vs-donate-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  box-sizing: border-box;
  margin-top: 6px;
  padding: 10px 12px;
  background: var(--vs-menu-button-bg);
  border: 1px solid var(--vs-menu-button-border);
  border-radius: 8px;
  color: var(--vs-text-primary);
  font: inherit;
  text-decoration: none;
  cursor: pointer;
  text-align: left;
}
.vs-donate-cloudtips:hover,
.vs-donate-toggle:hover {
  background: var(--vs-menu-button-bg-hover);
  border-color: var(--vs-menu-input-border);
}

.vs-donate-stack {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.vs-donate-label {
  font-weight: 500;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.vs-donate-desc {
  font-size: 11px;
  opacity: 0.55;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.vs-donate-chevron,
.vs-donate-external {
  opacity: 0.55;
  flex-shrink: 0;
}
.vs-donate-chevron {
  transition: transform 0.18s ease;
}
.vs-donate-toggle[aria-expanded="true"] .vs-donate-chevron {
  transform: rotate(180deg);
  opacity: 0.85;
}

.vs-donate-method { margin-top: 6px; }
.vs-donate-method .vs-donate-toggle { margin-top: 0; }

/* Expanded panel — sits flush under its toggle, visually attached. */
.vs-donate-detail {
  display: none;
  box-sizing: border-box;
  margin: 0;
  padding: 12px;
  background: var(--vs-menu-track-bg);
  border: 1px solid var(--vs-menu-button-border);
  border-top: none;
  border-radius: 0 0 8px 8px;
  font-size: 12px;
  line-height: 1.4;
}
.vs-donate-detail.show { display: block; }
.vs-donate-method:has(.vs-donate-detail.show) .vs-donate-toggle {
  border-radius: 8px 8px 0 0;
  border-bottom-color: transparent;
}

/* Numbered "what to do" steps inside the expanded crypto block. Each
   step renders on its own line; the wallet link sits right under
   step 1, the address+copy row right under step 2, and step 3 is the
   final paragraph explaining how to send from the wallet. */
.vs-donate-step {
  font-weight: 500;
  margin-top: 10px;
  opacity: 0.85;
}
.vs-donate-step:first-child { margin-top: 0; }
.vs-donate-step-final {
  font-weight: 400;
  opacity: 0.65;
}
.vs-donate-wallet-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
  font-weight: 500;
}
.vs-donate-wallet-link:hover { opacity: 0.85; }
.vs-donate-wallet-link svg {
  opacity: 0.7;
}

.vs-donate-address-row {
  display: flex;
  align-items: stretch;
  gap: 6px;
  margin-top: 4px;
}
.vs-donate-address {
  flex: 1;
  min-width: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10.5px;
  word-break: break-all;
  background: var(--vs-bg-track);
  color: var(--vs-text-primary);
  padding: 6px 8px;
  border-radius: 6px;
  user-select: all;
  display: flex;
  align-items: center;
  line-height: 1.3;
}
.vs-donate-copy-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  border-radius: 6px;
  background: var(--vs-menu-button-bg-hover);
  color: var(--vs-text-primary);
  cursor: pointer;
  border: 1px solid var(--vs-menu-button-border);
}
.vs-donate-copy-btn:hover {
  background: var(--vs-bg-track);
  border-color: var(--vs-menu-input-border);
}

/* Mobile / narrow desktop window adjustments. Mirror .user.js:2855-2860
   and 3769-3792. The chrome-mounted slider shrinks to 100px so it
   doesn't push the fullscreen / settings buttons out of the row. */
@media (max-width: 767px) {
  .vs-panel {
    margin-top: 40px;
    padding: 0 10px;
  }
  .speed-slider-container.vs-slider-in-chrome {
    width: auto;
    margin: 0 2px;
    height: 40px;
    flex: 0 1 auto;
  }
  .speed-slider-container.vs-slider-in-chrome .speed-slider {
    width: 100px;
  }
  .speed-slider-container.vs-slider-in-chrome .speed-slider-label {
    font-size: 10px !important;
  }
}

/* Honour the user's OS-level "reduce motion" preference (Windows
   Settings > Accessibility > Visual effects, macOS System Settings >
   Accessibility > Display > Reduce motion). Strips animations and
   transitions inside our scoped UI roots only — the active accent
   gradient, slider fill etc. stay; only fades/slides/pulses go. */
@media (prefers-reduced-motion: reduce) {
  .vs-panel *, .vs-panel,
  .settings-menu *, .settings-menu {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`;
