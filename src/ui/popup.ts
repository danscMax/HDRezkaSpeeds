/**
 * Speed popup -- the small "1.50x" overlay that appears briefly after a
 * speed change. Lives inside a dedicated DOM node managed here; callers
 * just invoke `showSpeedPopup(value)`.
 *
 * Ported from .user.js:1960-1980. Idempotent on the popup DOM node.
 */

const POPUP_ID = 'speed-popup';
const VISIBLE_MS = 2000;

let hideTimer: number | null = null;

export function showSpeedPopup(speed: number, container: Element | null = null): void {
  const popup = ensurePopup(container);
  popup.textContent = `${speed.toFixed(2)}x`;
  popup.classList.add('show');

  if (hideTimer !== null) clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    popup.classList.remove('show');
    hideTimer = null;
  }, VISIBLE_MS);
}

function ensurePopup(container: Element | null): HTMLElement {
  let popup = document.getElementById(POPUP_ID);
  if (popup) return popup;

  popup = document.createElement('div');
  popup.id = POPUP_ID;
  popup.className = 'speed-popup';
  // Per-site sizing/colour comes from styles.ts (`.speed-popup` rules
  // gated on `[data-vs-site]`). We only set `pointer-events:none` inline
  // so the popup cannot accidentally intercept clicks even before the
  // stylesheet finishes loading.
  popup.style.cssText = 'pointer-events: none;';

  const host = container instanceof HTMLElement ? container : document.body;
  // Tag the popup with the host's site if available so per-site CSS
  // (popup font-size, padding, light/dark theme) can target it. The
  // panel root has data-vs-site set in panel.ts.
  const panel = host.closest?.('.vs-panel') ?? document.querySelector('.vs-panel');
  const site = panel?.getAttribute('data-vs-site');
  if (site) popup.setAttribute('data-vs-site', site);
  host.appendChild(popup);
  return popup;
}

/**
 * Re-parent the popup into the fullscreen element when the user enters
 * fullscreen, and back into its anchor when they leave. Without this the
 * popup keeps its CSS-positioning anchor in the underlying document
 * coordinates and renders off-screen during fullscreen playback. Mirrors
 * .user.js:2599-2622. Returns a cleanup function.
 */
export function installFullscreenReparent(resolveAnchor: () => Element | null): () => void {
  function repositionPopup(): void {
    const popup = document.getElementById(POPUP_ID);
    if (!popup) return;
    const fs = document.fullscreenElement;
    const target = fs ?? resolveAnchor() ?? document.body;
    if (popup.parentElement !== target) {
      try {
        target.appendChild(popup);
      } catch {
        /* swallow */
      }
    }
  }
  const handler = (): void => repositionPopup();
  document.addEventListener('fullscreenchange', handler);
  return () => document.removeEventListener('fullscreenchange', handler);
}
