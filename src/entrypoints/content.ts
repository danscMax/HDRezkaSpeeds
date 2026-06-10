/**
 * Content script (isolated world).
 *
 * Has access to chrome.* APIs (storage, runtime, etc.) but runs in an isolated
 * JavaScript context separate from the page. HDRezka is not a SPA, so unlike
 * the YouTube+RuTube sibling project we don't ship a MAIN-world page-world
 * script — Plyr's localStorage writes and new-video mounts are handled from
 * the isolated world (sites/hdrezka.ts).
 */
import { defineContentScript } from 'wxt/utils/define-content-script';
import { builtinMatchPatterns } from '../sites/mirror-hosts';

export default defineContentScript({
  // Built-in mirrors only (src/sites/mirror-hosts.ts). User-added mirrors
  // are served by a dynamic registration of this same built file — see
  // reconcileMirrorScripts() in entrypoints/background.ts.
  matches: builtinMatchPatterns(),
  runAt: 'document_idle',
  allFrames: false,
  async main(ctx) {
    // Audit 2026-05-09 Q5: gate noisy info logs behind DEV.
    if (import.meta.env.DEV) {
      console.info('[HDREZKA-SPEEDS] content script loaded on', location.hostname);
    }
    // `signal` ties the listener's lifetime to ctx (WXT invalidates on
    // HMR / extension reload). Without it, dev rebuilds accumulate one
    // unhandledrejection filter per cycle.
    window.addEventListener(
      'unhandledrejection',
      (event) => {
        const reason = event.reason;
        const msg = reason instanceof Error ? reason.message : String(reason ?? '');
        if (/extension context (?:was )?invalidated/i.test(msg)) {
          event.preventDefault();
        }
      },
      { signal: ctx.signal },
    );
    const { bootstrap } = await import('../index');
    await bootstrap(ctx);
  },
});
