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

  // Audit 2026-05-11: open-extension-page proxy. Content scripts can't
  // navigate to chrome-extension:// URLs via window.open — the page's
  // own `window` (origin hdrezka.ag / rezka.ag / etc.) is treated as
  // the initiator and the target is not in `web_accessible_resources`,
  // so the browser silently drops the open. Routing through the
  // background SW works because the SW owns chrome.tabs and is
  // allowed to create tabs at extension URLs without the `tabs`
  // permission. Reachable from the in-player Settings → feedback CTA.
  // Strict allow-list of paths the proxy will open. WXT's getURL is
  // statically typed to known public paths, so we narrow on the wire
  // before resolving.
  const ALLOWED_PAGES = new Set(['/feedback.html', '/welcome.html']);
  browser.runtime.onMessage.addListener(
    (
      msg: unknown,
      sender,
    ): Promise<{ ok: boolean; error?: string }> | undefined => {
      if (!msg || typeof msg !== 'object') return undefined;
      const m = msg as { type?: unknown; path?: unknown };
      if (m.type !== 'open-extension-page') return undefined;
      if (typeof m.path !== 'string' || !ALLOWED_PAGES.has(m.path)) {
        return Promise.resolve({ ok: false, error: 'invalid_path' });
      }
      const url = browser.runtime.getURL(m.path as '/feedback.html' | '/welcome.html');
      void sender;
      return browser.tabs
        .create({ url })
        .then(() => ({ ok: true }))
        .catch((e: unknown) => ({ ok: false, error: String(e) }));
    },
  );
});
