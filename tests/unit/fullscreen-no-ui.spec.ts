import { afterEach, describe, expect, it } from 'vitest';
import { showActionChip, showNotification } from '../../src/ui/notifications';
import { injectStyles, removeStyles } from '../../src/ui/styles';

// The fullscreen rule, as it stands after the 2026-08-05 revision of the
// 2026-07-27 directive:
//   - PERSISTENT chrome (panel, in-chrome slider, speed popup) stays hidden —
//     it sits on top of the picture for as long as you watch.
//   - TRANSIENT messages (toasts, chips) DO show. Hiding them silenced the
//     only feedback a hotkey gives: in fullscreen the speed changed with
//     nothing on screen to confirm it.
// The second half also has a placement requirement: native fullscreen paints
// ONLY the fullscreen element's subtree, so a toast mounted in the player
// container while a DESCENDANT owns the screen is built, styled and invisible.

function setFullscreen(el: Element | null): void {
  Object.defineProperty(document, 'fullscreenElement', {
    value: el,
    configurable: true,
  });
}

afterEach(() => {
  setFullscreen(null);
  removeStyles(document);
  document.getElementById('speed-notifications')?.remove();
});

describe('fullscreen: persistent UI hidden, messages allowed', () => {
  it('hides panel, in-chrome slider and speed popup in native and Plyr-fallback fullscreen', () => {
    injectStyles('hdrezka', document);
    const css = document.getElementById('vs-styles')?.textContent ?? '';
    const rule = css
      .split('}')
      .find((block) => block.includes(':fullscreen') && block.includes('display: none'));
    expect(rule, 'no fullscreen hide rule in the injected stylesheet').toBeDefined();
    // Both fullscreen flavours must sit in the SAME forgiving :is() matcher —
    // splitting them lets an unknown :fullscreen invalidate the whole list.
    expect(rule).toContain('.plyr--fullscreen-fallback');
    for (const target of ['.vs-panel', '.vs-slider-in-chrome']) {
      expect(rule, `${target} not covered`).toContain(target);
    }
    // The centred speed popup must NOT be hidden: in fullscreen the panel is
    // gone, so the hotkey is the only control and this is its only feedback.
    expect(rule, 'speed popup is hidden again — the hotkey goes silent').not.toContain(
      '.speed-popup',
    );
  });

  it('shows a toast raised while fullscreen is active', () => {
    setFullscreen(document.body);
    showNotification('speed set');
    expect(document.getElementById('speed-notifications')).not.toBeNull();
    expect(document.body.textContent).toContain('speed set');
  });

  it('shows a chip raised while fullscreen is active, immediately', () => {
    setFullscreen(document.body);
    showActionChip('continue from 42:15');
    expect(document.body.textContent).toContain('continue from 42:15');
  });

  it('mounts the stack INSIDE the element that owns the screen', () => {
    // The regression this guards: the stack lived in the player container
    // while an inner element was fullscreen, so nothing was ever painted.
    const player = document.createElement('div');
    const inner = document.createElement('div');
    player.appendChild(inner);
    document.body.appendChild(player);
    try {
      setFullscreen(inner);
      showNotification('speed set', { playerContainer: player });
      const stack = document.getElementById('speed-notifications');
      expect(stack?.parentElement).toBe(inner);
      expect(stack?.style.position).toBe('fixed');
    } finally {
      player.remove();
    }
  });

  it('moves the stack back to the player container after leaving fullscreen', () => {
    const player = document.createElement('div');
    document.body.appendChild(player);
    try {
      setFullscreen(player);
      showNotification('in fullscreen', { playerContainer: player });
      setFullscreen(null);
      showNotification('back to normal', { playerContainer: player });
      const stack = document.getElementById('speed-notifications');
      expect(stack?.parentElement).toBe(player);
      expect(stack?.style.position).toBe('absolute');
    } finally {
      player.remove();
    }
  });

  it('still shows toasts outside fullscreen', () => {
    setFullscreen(null);
    showNotification('speed set');
    expect(document.getElementById('speed-notifications')).not.toBeNull();
    expect(document.body.textContent).toContain('speed set');
  });

  it("shows messages in Plyr's CSS-only pseudo-fullscreen too", () => {
    setFullscreen(null);
    const player = document.createElement('div');
    player.className = 'plyr plyr--fullscreen-fallback';
    document.body.appendChild(player);
    try {
      showNotification('speed set', { playerContainer: player });
      expect(document.body.textContent).toContain('speed set');
    } finally {
      player.remove();
    }
  });
});
