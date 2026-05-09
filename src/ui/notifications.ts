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

const STACK_ID = 'speed-notifications';

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
  const kind: NotificationKind = opts.kind ?? 'info';
  const duration = opts.duration ?? 3000;
  const dotColor = DOT_COLORS[kind] ?? DOT_COLORS.info;

  const stack = ensureStack(opts.playerContainer ?? null);

  const toast = document.createElement('div');
  toast.style.cssText = `
    background: rgba(0, 0, 0, 0.85) !important;
    backdrop-filter: blur(10px) !important;
    -webkit-backdrop-filter: blur(10px) !important;
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
    opacity: 0;
    transform: translateX(20px);
    transition: opacity 0.25s ease, transform 0.25s ease !important;
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
