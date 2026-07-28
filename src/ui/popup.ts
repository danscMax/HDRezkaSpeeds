/**
 * Speed popup -- the small "1.50x" overlay that appears briefly after a
 * speed change. Lives inside a dedicated DOM node managed here; callers
 * just invoke `showSpeedPopup(value)`.
 *
 * Ported from .user.js:1960-1980. Idempotent on the popup DOM node.
 */

const POPUP_ID = 'speed-popup';
const VISIBLE_MS = 2000;

// Audit 2026-05-09 sec C18: hideTimer used to be a module-level singleton
// shared across panel lifecycles. After dispose+re-create, the previous
// timer kept running and cleared a popup that was already detached. Now
// we attach the timer to the popup DOM node itself via a WeakMap, so it
// dies naturally with the node.
const hideTimers = new WeakMap<HTMLElement, number>();

export function showSpeedPopup(speed: number, container: Element | null = null): void {
  const popup = ensurePopup(container);
  popup.textContent = `${speed.toFixed(2)}x`;
  popup.classList.add('show');

  const prev = hideTimers.get(popup);
  if (prev !== undefined) clearTimeout(prev);
  const id = window.setTimeout(() => {
    popup.classList.remove('show');
    hideTimers.delete(popup);
  }, VISIBLE_MS);
  hideTimers.set(popup, id);
}

/**
 * Tear down the speed popup completely (audit 2026-05-09 sec C16).
 * Called from panel.dispose() so a new panel doesn't inherit the
 * detached node from the previous lifecycle.
 */
export function disposeSpeedPopup(): void {
  const popup = document.getElementById(POPUP_ID);
  if (!popup) return;
  const id = hideTimers.get(popup);
  if (id !== undefined) {
    clearTimeout(id);
    hideTimers.delete(popup);
  }
  popup.remove();
}

function ensurePopup(container: Element | null): HTMLElement {
  const existing = document.getElementById(POPUP_ID);
  // Reuse only when the node is still in the document tree (audit
  // 2026-05-09 sec C16). A stale node from a torn-down player container
  // would otherwise be reused and render at coordinates the host page
  // has since rebuilt.
  if (existing?.isConnected) return existing;
  if (existing) {
    const id = hideTimers.get(existing);
    if (id !== undefined) {
      clearTimeout(id);
      hideTimers.delete(existing);
    }
    existing.remove();
  }
  const popup = document.createElement('div');
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

// The fullscreen re-parent that used to live here (.user.js:2599-2622,
// port of the "popup follows you into fullscreen" behaviour) is gone: the
// extension shows no UI in fullscreen at all (user directive 2026-07-27).
// The popup is hidden by the `:fullscreen .speed-popup` rule in styles.ts
// whenever its host lands inside the fullscreen subtree.
