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

export default defineContentScript({
  matches: [
    '*://*.hdrezka.ag/*',
    '*://hdrezka.ag/*',
    '*://*.rezka.ag/*',
    '*://rezka.ag/*',
    '*://*.hdrezka.me/*',
    '*://hdrezka.me/*',
    '*://*.hdrezka.co/*',
    '*://hdrezka.co/*',
    '*://*.hdrezka.website/*',
    '*://hdrezka.website/*',
    '*://*.hdrezka.cm/*',
    '*://hdrezka.cm/*',
    '*://*.hdrezka-home.tv/*',
    '*://hdrezka-home.tv/*',
    '*://*.rezkify.com/*',
    '*://rezkify.com/*',
    '*://*.rezkery.com/*',
    '*://rezkery.com/*',
    '*://*.kinopub.me/*',
    '*://kinopub.me/*',
  ],
  runAt: 'document_idle',
  allFrames: false,
  async main(ctx) {
    console.info('[HDREZKA-SPEEDS] content script loaded on', location.hostname);
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      const msg = reason instanceof Error ? reason.message : String(reason ?? '');
      if (/extension context (?:was )?invalidated/i.test(msg)) {
        event.preventDefault();
      }
    });
    const { bootstrap } = await import('../index');
    await bootstrap(ctx);
  },
});
