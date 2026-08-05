import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('gives a sticky chip a deadline in fullscreen, but not in a window', () => {
    // A chip is normally sticky (duration 0) and waits for a decision. On top
    // of a film that means a box parked on the picture until someone hunts
    // for its ✕ — so fullscreen swaps "sticky" for "long enough to act".
    vi.useFakeTimers();
    try {
      setFullscreen(document.body);
      showActionChip('continue from 42:15');
      expect(document.body.textContent).toContain('continue from 42:15');
      vi.advanceTimersByTime(8000 + 300);
      expect(document.body.textContent).not.toContain('continue from 42:15');

      setFullscreen(null);
      showActionChip('still here');
      vi.advanceTimersByTime(60_000);
      expect(document.body.textContent).toContain('still here');
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies the deadline in Plyr pseudo-fullscreen too', () => {
    // Plyr's fallback leaves fullscreenElement null — checking only that would
    // have left a sticky chip parked on the picture on exactly the player this
    // extension was written for.
    vi.useFakeTimers();
    const player = document.createElement('div');
    player.className = 'plyr plyr--fullscreen-fallback';
    document.body.appendChild(player);
    try {
      setFullscreen(null);
      showActionChip('parked?', { playerContainer: player });
      expect(document.body.textContent).toContain('parked?');
      vi.advanceTimersByTime(8000 + 300);
      expect(document.body.textContent).not.toContain('parked?');
    } finally {
      player.remove();
      vi.useRealTimers();
    }
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

describe('the fullscreen popup rule must outrank the per-theme rule', () => {
  // The regression this pins: `:is(:fullscreen, …) #speed-popup.speed-popup`
  // scores (1,2,0), while `html[data-vs-theme="light"] #speed-popup.speed-popup
  // [data-vs-site="…"]` scores (1,3,1). Source order cannot save the weaker
  // one, so the fullscreen popup silently kept the light page's white plate
  // while floating over video. Specificity is computed here rather than
  // eyeballed because that is exactly what was got wrong by eye.
  const specificity = (selector: string): [number, number, number] => {
    let s = selector;
    // :is() contributes the weight of its most specific branch.
    s = s.replace(/:is\(([^)]*)\)/g, (_m, inner: string) => {
      const best = inner
        .split(',')
        .map((b) => b.trim())
        .sort((a, b) => specificity(b)[1] - specificity(a)[1])[0];
      return best ?? '';
    });
    const ids = (s.match(/#[\w-]+/g) ?? []).length;
    const classes =
      (s.match(/\.[\w-]+/g) ?? []).length +
      (s.match(/\[[^\]]+\]/g) ?? []).length +
      (s.match(/:(?!:)[\w-]+/g) ?? []).length;
    const elements = (s.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) ?? []).length;
    return [ids, classes, elements];
  };
  const beats = (a: [number, number, number], b: [number, number, number]): boolean => {
    for (let i = 0; i < 3; i++) {
      if (a[i] !== b[i]) return a[i] > b[i];
    }
    return false;
  };

  it('wins on specificity, not on source order', () => {
    injectStyles('hdrezka', document);
    const css = document.getElementById('vs-styles')?.textContent ?? '';
    // Strip comments FIRST: the naive split treats everything before a `{` as
    // the selector, so a comment that mentions other selectors silently
    // inflates the specificity it computes — which is how the first version of
    // this guard passed against a stylesheet it should have rejected.
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = [...bare.matchAll(/([^{}]+)\{[^}]*\}/g)].map((m) => m[1].trim());
    const fsRule = selectors.find(
      (s) =>
        s.includes(':fullscreen') &&
        s.includes('#speed-popup') &&
        s.includes('font-size') === false,
    );
    const themeRule = selectors.find((s) => s.includes('#speed-popup') && /html[[:]/.test(s));
    expect(fsRule, 'no fullscreen popup rule found').toBeDefined();
    expect(themeRule, 'no per-theme popup rule found').toBeDefined();
    expect(
      beats(specificity(fsRule as string), specificity(themeRule as string)),
      `fullscreen ${JSON.stringify(specificity(fsRule as string))} does not beat theme ${JSON.stringify(specificity(themeRule as string))}`,
    ).toBe(true);
  });
});
