/**
 * Toast notifications, dot-indicator style.
 *
 * Visual contract (preserved from .user.js:2649-2760, intentional design
 * choice the user signed off on):
 *   - auto-fit blob, no min/max width
 *   - 6px coloured dot LEFT of the text, no emoji, no border-left
 *   - colour communicates kind (info/warn/error)
 *   - stacks bottom-up inside the player container; falls back to body
 *     position:fixed when the player is missing
 *   - 250ms slide-in / slide-out, 3000ms default visible duration
 *
 * Pointer-events:none on the stack so clicks pass through to the player.
 */

import type { NotificationKind } from '../app/ports';
import { h } from './dom-h';
import { type IconName, vsIcon } from './icons';

const STACK_ID = 'speed-notifications';

/**
 * How long a normally-sticky chip stays up when it is raised in fullscreen.
 * Long enough to read "Continue from 42:15" and click it, short enough that
 * ignoring it does not leave a box parked on the film. In a window a sticky
 * chip stays sticky — there the picture is not the whole screen.
 */
const FULLSCREEN_CHIP_MS = 8000;

/**
 * Fullscreen in BOTH flavours this codebase has to live with: the real thing,
 * and Plyr's CSS-only fallback (used when the Fullscreen API is unavailable —
 * it sets a class, fires no event and leaves `fullscreenElement` null).
 *
 * This answers "is the picture the whole screen". The re-parenting below asks
 * a NARROWER question (`document.fullscreenElement`) on purpose: only native
 * fullscreen restricts painting to one subtree, while under the Plyr fallback
 * the player container is already what fills the screen.
 */
function isFullscreen(): boolean {
  return (
    document.fullscreenElement != null ||
    document.querySelector('.plyr--fullscreen-fallback') != null
  );
}

/**
 * Native fullscreen renders ONLY the fullscreen element's subtree. The toast
 * stack normally lives inside the player container, which is the WRONG side of
 * that boundary whenever the element that went fullscreen is a descendant —
 * the toast exists, is styled, and is simply not painted. So while fullscreen
 * is active the stack is re-parented under whatever element owns the screen,
 * and switched to viewport-anchored positioning (inside the top layer, `fixed`
 * means "relative to the fullscreen area").
 */
function mountForFullscreen(stack: HTMLElement, playerContainer: Element | null): void {
  const fs = document.fullscreenElement;
  if (fs) {
    if (stack.parentElement !== fs) fs.appendChild(stack);
    stack.style.position = 'fixed';
    return;
  }
  const host = playerContainer instanceof HTMLElement ? playerContainer : document.body;
  if (stack.parentElement !== host) host.appendChild(stack);
  stack.style.position = playerContainer instanceof HTMLElement ? 'absolute' : 'fixed';
}

const DOT_COLORS: Record<NotificationKind, string> = {
  info: '#2196F3',
  success: '#4CAF50',
  warn: '#ff9800',
  error: '#f44336',
};

export interface NotificationOptions {
  kind?: NotificationKind;
  duration?: number;
  /** Player container the toast lives inside; falls back to body. */
  playerContainer?: Element | null;
}

/**
 * Render a toast. Idempotent on the stack container -- multiple calls reuse
 * the same `#speed-notifications` div.
 */
export function showNotification(text: string, opts: NotificationOptions = {}): void {
  // Toasts DO show in fullscreen (user directive 2026-08-05, reversing the
  // 2026-07-27 blanket ban). The ban was aimed at persistent chrome sitting on
  // top of the picture — panel, slider, gear — but it also silenced the only
  // feedback a hotkey gives: pressing Alt+. in fullscreen changed the speed
  // with nothing on screen to confirm it. The panel and slider stay hidden;
  // what comes back is the transient message that disappears on its own.
  const kind: NotificationKind = opts.kind ?? 'info';
  const duration = opts.duration ?? 3000;
  const dotColor = DOT_COLORS[kind] ?? DOT_COLORS.info;

  const stack = ensureStack(opts.playerContainer ?? null);
  mountForFullscreen(stack, opts.playerContainer ?? null);

  // The toast lives outside .vs-panel/.settings-menu and carries an inline
  // `transition …!important`, so the stylesheet's reduced-motion block can't
  // reach it — guard the slide/fade in JS instead (a11y). Appears/disappears
  // instantly when the user asked for reduced motion.
  const reduceMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const toast = document.createElement('div');
  // VIS-010: 0.92 alpha + a kind-tinted hairline border. At 0.85 the blob
  // melted into near-black player backgrounds and the dot was the only
  // separation cue.
  toast.style.cssText = `
    background: rgba(8, 8, 10, 0.92) !important;
    backdrop-filter: blur(10px) !important;
    -webkit-backdrop-filter: blur(10px) !important;
    border: 1px solid ${dotColor}66 !important;
    border-radius: 8px !important;
    padding: 8px 14px !important;
    color: white !important;
    font-family: 'Roboto', -apple-system, BlinkMacSystemFont, sans-serif !important;
    font-size: 13px !important;
    font-weight: 500 !important;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4) !important;
    display: inline-flex !important;
    align-items: center !important;
    gap: 8px !important;
    pointer-events: auto !important;
    white-space: nowrap !important;
    max-width: min(80vw, 480px) !important;
    opacity: ${reduceMotion ? '1' : '0'};
    transform: ${reduceMotion ? 'none' : 'translateX(20px)'};
    transition: ${reduceMotion ? 'none' : 'opacity 0.25s ease, transform 0.25s ease'} !important;
  `;

  // Text comes from i18n -- already plain text by the M3 contract.
  // textContent is XSS-safe by construction; no escaping needed when we
  // build the DOM programmatically (replaces the previous escapeForSpan
  // helper, which was only there to guard the innerHTML path).
  toast.appendChild(
    h('span', {
      style: `display:inline-block; width:6px; height:6px; border-radius:50%; background:${dotColor}; flex-shrink:0; box-shadow: 0 0 0 3px ${dotColor}26;`,
    }),
  );
  toast.appendChild(
    h(
      'span',
      { style: 'line-height:1.3; overflow:hidden; text-overflow:ellipsis;' },
      String(text ?? ''),
    ),
  );

  stack.appendChild(toast);

  // Two RAFs so the browser paints the initial state before the transition.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(0)';
    });
  });

  // Audit 2026-05-09 MAJOR-UI: stash timer IDs on the toast itself so
  // disposeNotificationStack() can clear them. Otherwise a fast dispose
  // leaves up to two zombie timeouts ticking for ~3.25s after the panel
  // goes away.
  const tagged = toast as HTMLElement & { __vsTimer1?: number; __vsTimer2?: number };
  tagged.__vsTimer1 = window.setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    tagged.__vsTimer2 = window.setTimeout(() => {
      toast.parentNode?.removeChild(toast);
    }, 250);
  }, duration);
}

export interface ActionChipOptions {
  kind?: NotificationKind;
  /** Leading glyph (tinted with the kind colour). */
  icon?: IconName;
  /** Clicking the message body fires this — the resume-style whole-chip
   *  action. Its label IS `text`. */
  onActivate?: () => void;
  /** An explicit trailing action button (failure-style "Reload"). */
  action?: { label: string; onClick: () => void };
  /** ms visible; 0 (default) = sticky until dismissed / activated. */
  duration?: number;
  playerContainer?: Element | null;
  /** aria-label for the ✕ button (localised by the caller). */
  dismissLabel?: string;
}

/**
 * A durable, actionable chip in the notifications stack. Unlike
 * showNotification it does NOT auto-dismiss by default; it carries an
 * optional leading icon, a clickable body and/or a trailing action button,
 * and a ✕. Real <button>s inside make it keyboard-operable for free.
 *
 * Returns an idempotent close() so the caller can dismiss it
 * programmatically (e.g. the resume chip closing once playback passes the
 * saved point, or a new episode loads).
 */
export function showActionChip(text: string, opts: ActionChipOptions = {}): () => void {
  // Chips show in fullscreen too (user directive 2026-08-05) — they used to be
  // queued until the user left it, which meant a message that never arrived.
  // But a chip is normally STICKY (duration 0, waits for a decision), and a
  // rectangle parked on top of a film until someone finds its ✕ is exactly the
  // chrome the fullscreen rule exists to keep off the picture. So in
  // fullscreen a sticky chip gets a deadline instead: long enough to read and
  // act on, short enough that ignoring it costs nothing.
  const kind: NotificationKind = opts.kind ?? 'info';
  const color = DOT_COLORS[kind] ?? DOT_COLORS.info;
  const sticky = (opts.duration ?? 0) === 0;
  const duration = sticky && isFullscreen() ? FULLSCREEN_CHIP_MS : (opts.duration ?? 0);
  const stack = ensureStack(opts.playerContainer ?? null);
  mountForFullscreen(stack, opts.playerContainer ?? null);

  const reduceMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const chip = document.createElement('div');
  chip.style.cssText = `
    background: rgba(8, 8, 10, 0.92) !important;
    backdrop-filter: blur(10px) !important;
    -webkit-backdrop-filter: blur(10px) !important;
    border: 1px solid ${color}66 !important;
    border-radius: 8px !important;
    padding: 6px 8px 6px 12px !important;
    color: white !important;
    font-family: 'Roboto', -apple-system, BlinkMacSystemFont, sans-serif !important;
    font-size: 13px !important;
    font-weight: 500 !important;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4) !important;
    display: inline-flex !important;
    align-items: center !important;
    gap: 8px !important;
    pointer-events: auto !important;
    max-width: min(80vw, 480px) !important;
    opacity: ${reduceMotion ? '1' : '0'};
    transform: ${reduceMotion ? 'none' : 'translateX(20px)'};
    transition: ${reduceMotion ? 'none' : 'opacity 0.25s ease, transform 0.25s ease'} !important;
  `;

  const tagged = chip as HTMLElement & { __vsTimer1?: number; __vsTimer2?: number };
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    if (tagged.__vsTimer1 !== undefined) clearTimeout(tagged.__vsTimer1);
    if (reduceMotion) {
      chip.parentNode?.removeChild(chip);
      return;
    }
    chip.style.opacity = '0';
    chip.style.transform = 'translateX(20px)';
    tagged.__vsTimer2 = window.setTimeout(() => chip.parentNode?.removeChild(chip), 250);
  };

  const iconEl = opts.icon ? vsIcon(opts.icon, 15) : null;
  if (iconEl) {
    iconEl.style.color = color;
    iconEl.style.flexShrink = '0';
  }
  const label = h('span', { style: 'line-height:1.3; white-space:nowrap;' }, String(text ?? ''));

  // Body: a real button when it is itself the action (resume), else a plain
  // wrapper. Either way it holds the icon + label.
  const bodyChildren: (Node | string)[] = [];
  if (iconEl) bodyChildren.push(iconEl);
  bodyChildren.push(label);
  if (opts.onActivate) {
    const bodyBtn = h(
      'button',
      {
        type: 'button',
        style:
          'display:inline-flex; align-items:center; gap:8px; background:none; border:none; padding:0; margin:0; color:inherit; font:inherit; cursor:pointer;',
      },
      ...bodyChildren,
    );
    bodyBtn.addEventListener('click', () => {
      opts.onActivate?.();
      close();
    });
    makeHoverable(bodyBtn);
    chip.appendChild(bodyBtn);
  } else {
    chip.appendChild(
      h('span', { style: 'display:inline-flex; align-items:center; gap:8px;' }, ...bodyChildren),
    );
  }

  if (opts.action) {
    const cta = h(
      'button',
      {
        type: 'button',
        style: `flex-shrink:0; padding:3px 10px; border:1px solid ${color}66; border-radius:6px; background:${color}22; color:white; font:inherit; font-size:12px; font-weight:600; cursor:pointer; white-space:nowrap;`,
      },
      opts.action.label,
    );
    cta.addEventListener('click', () => {
      opts.action?.onClick();
      close();
    });
    makeHoverable(cta);
    chip.appendChild(cta);
  }

  const closeBtn = h('button', {
    type: 'button',
    'aria-label': opts.dismissLabel ?? 'Dismiss',
    style:
      'display:inline-flex; align-items:center; flex-shrink:0; background:none; border:none; padding:2px; margin:0; color:rgba(255,255,255,0.6); cursor:pointer; border-radius:4px;',
  });
  const xIcon = vsIcon('x', 14);
  closeBtn.appendChild(xIcon);
  closeBtn.addEventListener('click', close);
  closeBtn.addEventListener('mouseenter', () => {
    closeBtn.style.color = 'white';
  });
  closeBtn.addEventListener('mouseleave', () => {
    closeBtn.style.color = 'rgba(255,255,255,0.6)';
  });
  chip.appendChild(closeBtn);

  stack.appendChild(chip);

  if (!reduceMotion) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (closed) return;
        chip.style.opacity = '1';
        chip.style.transform = 'translateX(0)';
      });
    });
  }

  if (duration > 0) {
    tagged.__vsTimer1 = window.setTimeout(close, duration);
  }

  return close;
}

/** Subtle hover feedback for an interactive chip element (no :hover inline). */
function makeHoverable(el: HTMLElement): void {
  el.addEventListener('mouseenter', () => {
    el.style.opacity = '0.75';
  });
  el.addEventListener('mouseleave', () => {
    el.style.opacity = '1';
  });
}

/**
 * Tear down the notifications stack and any in-flight toast timers
 * (audit 2026-05-09 sec C16/C17). Restores the inline `position` we
 * may have mutated on the player container.
 */
export function disposeNotificationStack(): void {
  const stack = document.getElementById(STACK_ID);
  if (!stack) return;
  for (const child of Array.from(stack.children)) {
    const tagged = child as HTMLElement & { __vsTimer1?: number; __vsTimer2?: number };
    if (tagged.__vsTimer1 !== undefined) clearTimeout(tagged.__vsTimer1);
    if (tagged.__vsTimer2 !== undefined) clearTimeout(tagged.__vsTimer2);
  }
  // Restore the host container's inline position if we mutated it.
  const host = stack.parentElement;
  if (host instanceof HTMLElement) {
    const tagged = host as HTMLElement & { __vsPriorPosition?: string };
    if (tagged.__vsPriorPosition !== undefined) {
      if (tagged.__vsPriorPosition === '') host.style.removeProperty('position');
      else host.style.position = tagged.__vsPriorPosition;
      delete tagged.__vsPriorPosition;
    }
  }
  stack.remove();
}

function ensureStack(playerContainer: Element | null): HTMLElement {
  let stack = document.getElementById(STACK_ID);
  if (stack) return stack;

  stack = document.createElement('div');
  stack.id = STACK_ID;

  const styleInPlayer = `
    position: absolute !important;
    top: 50% !important;
    right: 20px !important;
    transform: translateY(20px) !important;
    z-index: 100001 !important;
    display: flex !important;
    flex-direction: column !important;
    gap: 8px !important;
    pointer-events: none !important;
    align-items: flex-end !important;
  `;
  const styleInBody = `
    position: fixed !important;
    top: 50% !important;
    right: 40px !important;
    transform: translateY(20px) !important;
    z-index: 2147483647 !important;
    display: flex !important;
    flex-direction: column !important;
    gap: 8px !important;
    pointer-events: none !important;
    align-items: flex-end !important;
  `;

  if (playerContainer instanceof HTMLElement) {
    // Audit 2026-05-09 sec C17: remember the prior inline position so
    // disposeNotificationStack() can restore it. Mutating the host's
    // position to relative used to leak across reload cycles when YT's
    // player chrome was already styled with a specific stacking context.
    if (window.getComputedStyle(playerContainer).position === 'static') {
      const tagged = playerContainer as HTMLElement & { __vsPriorPosition?: string };
      if (tagged.__vsPriorPosition === undefined) {
        tagged.__vsPriorPosition = playerContainer.style.position; // '' if unset
      }
      playerContainer.style.position = 'relative';
    }
    stack.style.cssText = styleInPlayer;
    playerContainer.appendChild(stack);
  } else {
    stack.style.cssText = styleInBody;
    document.body.appendChild(stack);
  }

  return stack;
}
