/**
 * HDRezka site bootstrap.
 *
 * HDRezka is a classic multi-page site, NOT a SPA. Series episodes can be
 * switched without a full reload (the player iframe re-mounts a fresh
 * <video> element via Plyr), so we still need a navigation-style hook —
 * but it's a MutationObserver looking for the next video element rather
 * than a history-API patch.
 *
 * Plyr also persists its own playback rate to localStorage as part of the
 * settings blob. We patch localStorage.setItem to strip the `speed` key
 * out of any Plyr write, otherwise Plyr races our restore on every
 * episode change. This mirrors the userscript reference (.user.js:2014-2032).
 */

import type { AppContext } from '../app/context';

export interface HDRezkaSiteHandle {
  /** Fired when a new <video> element appears (e.g. episode change). */
  onNavigation(fn: () => void): void;
}

export function bootstrapHDRezkaSite(ctx: AppContext): HDRezkaSiteHandle {
  const subscribers = new Set<() => void>();

  patchPlyrLocalStorage(ctx);

  // Track which <video> elements we've already announced so we don't spam
  // subscribers on every unrelated DOM mutation.
  const seenVideos = new WeakSet<HTMLVideoElement>();
  const announceIfNew = (v: HTMLVideoElement | null): void => {
    if (!v || seenVideos.has(v)) return;
    seenVideos.add(v);
    ctx.logger.debug('site:hdrezka new video element detected');
    for (const fn of subscribers) {
      try { fn(); } catch (e) { ctx.logger.error('site:hdrezka nav handler', e); }
    }
  };

  // Initial scan + observer for future <video> mounts (episode switching,
  // ad rolls, fullscreen mode reattach).
  for (const v of document.querySelectorAll('video')) {
    announceIfNew(v as HTMLVideoElement);
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node instanceof HTMLVideoElement) {
          announceIfNew(node);
        } else if (node instanceof Element) {
          for (const v of node.querySelectorAll('video')) {
            announceIfNew(v as HTMLVideoElement);
          }
        }
      }
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  ctx.cleanup.addObserver(observer);

  return {
    onNavigation(fn) { subscribers.add(fn); },
  };
}

/**
 * Block Plyr's persistent rate writes. Plyr saves its full settings (incl.
 * `speed`) into `plyr` / `plyr-speed` / `plyr-settings` localStorage keys.
 * On every episode load it reads them back and resets playbackRate to its
 * own remembered value, racing our restore. We strip just the `speed`
 * field from those writes.
 *
 * Idempotent: if the patch is already installed (e.g. from a previous
 * content-script load that the WXT runtime is replacing), we skip.
 */
function patchPlyrLocalStorage(ctx: AppContext): void {
  type Patched = Storage & { __vsPlyrPatched?: boolean };
  const ls = window.localStorage as Patched;
  if (ls.__vsPlyrPatched) return;

  try {
    const original = ls.setItem.bind(ls);
    ls.setItem = function patched(key: string, value: string): void {
      if (key === 'plyr' || key === 'plyr-speed' || key === 'plyr-settings') {
        try {
          const data = JSON.parse(value);
          if (data && typeof data === 'object' && 'speed' in data) {
            ctx.logger.debug(`Plyr write blocked: speed=${data.speed}`);
            delete data.speed;
            return original(key, JSON.stringify(data));
          }
        } catch {
          // Not JSON — pass through.
        }
      }
      return original(key, value);
    };
    ls.__vsPlyrPatched = true;
    ctx.cleanup.add(() => {
      try {
        ls.setItem = original;
        delete ls.__vsPlyrPatched;
      } catch { /* swallow */ }
    });
  } catch (e) {
    ctx.logger.warn('Failed to patch Plyr localStorage', e);
  }
}
