/**
 * MV3 service worker. We only use it for one-shot install hooks — the
 * heavy lifting still lives in the content script. Anything more would
 * pull us into the persistent-vs-event-driven service-worker debate;
 * for now this is a 5-line module.
 *
 * Why we have it:
 *   chrome.runtime.onInstalled is the only Chrome API that fires
 *   exactly once when the user clicks "Add to Chrome" from the
 *   Web Store. We use that signal to open welcome.html in a new tab —
 *   the canonical 2026 onboarding pattern (drops week-1 uninstall,
 *   per the Chrome Best Practices guide). Subsequent updates fire
 *   the same hook with reason='update', which we explicitly ignore
 *   so a Chrome auto-update doesn't barge a tab in front of the
 *   user.
 */

import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason !== 'install') return;
    const url = browser.runtime.getURL('/welcome.html');
    void browser.tabs.create({ url });
  });
});
