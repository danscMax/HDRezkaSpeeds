/**
 * Auto-follow "sniffer" content script (FEAT-019, optimisation #10).
 *
 * Registered dynamically & broadly by the background SW ONLY while the user
 * has opted into auto-follow AND granted the broad all-sites host permission
 * (see reconcileAutoFollowScript in entrypoints/background.ts). `registration:
 * 'runtime'` keeps it out of the manifest entirely — it adds nothing to
 * `content_scripts` and nothing to `host_permissions`, so the opt-in model is
 * untouched.
 *
 * Its whole job: cheaply decide whether THIS page is an HDRezka video page
 * (by the engine's DOM signature, not the domain name) and, if so, ask the SW
 * to inject the real 219 KB content script into this tab via
 * `chrome.scripting.executeScript`. On every non-HDRezka page the broad-mode
 * user visits, only this tiny bundle is parsed — the heavy script never loads.
 *
 * Deliberately import-light: it pulls in ONLY looksLikeHDRezka +
 * isHDRezkaVideoPath from sites/detect (whose transitive graph is just the
 * small discovery selector tables). It must never import ../index or any UI /
 * discovery module, or the bundle balloons and the optimisation evaporates.
 */
import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { isHDRezkaVideoPath, looksLikeHDRezka } from '../sites/detect';

export default defineContentScript({
  // No `matches`: registered at runtime by the SW against the granted broad
  // permission. Listing `*://*/*` here would (with registration:'runtime')
  // hoist it into REQUIRED host_permissions and break the opt-in.
  registration: 'runtime',
  runAt: 'document_idle',
  allFrames: false,
  main(ctx) {
    // Gate on the video-path allow-list too: looksLikeHDRezka can match a
    // rezka listing page's info blocks, but the full script would just bail
    // on a non-video path — skip that wasted injection.
    const isHit = (): boolean => isHDRezkaVideoPath(location.pathname) && looksLikeHDRezka();

    const requestInjection = (): void => {
      void browser.runtime.sendMessage({ type: 'auto-follow:inject' }).catch(() => {
        // SW asleep / context invalidated — best-effort; a reload re-fires.
      });
    };

    if (isHit()) {
      requestInjection();
      return;
    }

    // Bounded wait: HDRezka's player markers aren't guaranteed in the DOM the
    // instant document_idle fires. Observe mutations (coalesced to one check
    // per frame, mirroring awaitHDRezkaSignature in src/index.ts) and bail
    // after the budget — a genuine non-rezka page never matches.
    let done = false;
    let scanQueued = false;
    let observer: MutationObserver | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = (): void => {
      if (done) return;
      done = true;
      observer?.disconnect();
      if (timer !== null) clearTimeout(timer);
    };
    observer = new MutationObserver(() => {
      if (scanQueued || done) return;
      scanQueued = true;
      requestAnimationFrame(() => {
        scanQueued = false;
        if (done || !isHit()) return;
        stop();
        requestInjection();
      });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    timer = setTimeout(stop, 2500);
    ctx.onInvalidated(stop);
  },
});
