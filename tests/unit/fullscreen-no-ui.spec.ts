import { afterEach, describe, expect, it } from 'vitest';
import { showActionChip, showNotification } from '../../src/ui/notifications';
import { injectStyles, removeStyles } from '../../src/ui/styles';

// Regression guard for "no extension UI in fullscreen" (user directive
// 2026-07-27). Two halves, matching the two mechanisms:
//   - CSS  : the surfaces that live INSIDE the player are hidden by
//            :fullscreen rules in the injected stylesheet.
//   - JS   : the toast/chip stack carries inline display-!important, which
//            no stylesheet can override, so it must not be built at all.

function setFullscreen(on: boolean): void {
  Object.defineProperty(document, 'fullscreenElement', {
    value: on ? document.body : null,
    configurable: true,
  });
}

afterEach(() => {
  setFullscreen(false);
  removeStyles(document);
  document.getElementById('speed-notifications')?.remove();
});

describe('fullscreen: no extension UI', () => {
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
    for (const target of ['.vs-panel', '.vs-slider-in-chrome', '.speed-popup']) {
      expect(rule, `${target} not covered`).toContain(target);
    }
  });

  it('builds no toast stack while fullscreen is active', () => {
    setFullscreen(true);
    showNotification('speed set');
    showActionChip('resume?');
    expect(document.getElementById('speed-notifications')).toBeNull();
  });

  it('still shows toasts and chips outside fullscreen', () => {
    setFullscreen(false);
    showNotification('speed set');
    expect(document.getElementById('speed-notifications')).not.toBeNull();
    expect(document.body.textContent).toContain('speed set');
  });

  it('defers a chip raised in fullscreen until the user leaves it', () => {
    setFullscreen(true);
    showActionChip('continue from 42:15');
    expect(document.getElementById('speed-notifications')).toBeNull();

    setFullscreen(false);
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(document.getElementById('speed-notifications')).not.toBeNull();
    expect(document.body.textContent).toContain('continue from 42:15');
  });

  it('drops a deferred chip whose close() was called while still fullscreen', () => {
    setFullscreen(true);
    const close = showActionChip('stale offer');
    close();

    setFullscreen(false);
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(document.body.textContent).not.toContain('stale offer');
  });

  it('treats Plyr CSS-only pseudo-fullscreen as fullscreen too', () => {
    setFullscreen(false);
    const player = document.createElement('div');
    player.className = 'plyr plyr--fullscreen-fallback';
    document.body.appendChild(player);
    try {
      showNotification('speed set');
      expect(document.getElementById('speed-notifications')).toBeNull();

      // Its exit fires no event, so a chip must be DROPPED here rather than
      // queued into a flush that can never run.
      showActionChip('would never surface');
      player.remove();
      document.dispatchEvent(new Event('fullscreenchange'));
      expect(document.body.textContent).not.toContain('would never surface');
    } finally {
      player.remove();
    }
  });
});
