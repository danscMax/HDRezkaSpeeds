import { defineConfig } from 'wxt';
import pkg from './package.json' with { type: 'json' };
import { builtinMatchPatterns, BUILTIN_MIRROR_HOSTS } from './src/sites/mirror-hosts';

// connect-src for the extension_pages CSP. Two legitimate outbound endpoints:
// the feedback worker (feedback POST) and the built-in mirror hosts — the
// "Open HDRezka" reachability probe fetches each mirror's homepage from the
// background. In FIREFOX the background is an EVENT PAGE (an extension page),
// so it runs under extension_pages CSP: without the mirror hosts here the
// probe fetch is blocked and every mirror looks dead (Chrome's service worker
// is NOT under this CSP, but we ship one policy for both). Built from the same
// BUILTIN_MIRROR_HOSTS as host_permissions so the two can never drift.
// Note: user-added / auto-follow mirrors are NOT listed (arbitrary hosts) — a
// deliberately tight connect-src; their probe is best-effort only.
const FEEDBACK_WORKER = 'https://speeds-feedback.matsiyak.workers.dev';
const MIRROR_CONNECT_SRC = BUILTIN_MIRROR_HOSTS.flatMap((host) => [
  `https://${host}`,
  `https://*.${host}`,
]).join(' ');
const EXTENSION_PAGES_CSP =
  `script-src 'self'; object-src 'self'; ` +
  `connect-src 'self' ${FEEDBACK_WORKER} ${MIRROR_CONNECT_SRC}`;

// WXT config: builds Chrome MV3 + Firefox MV3 from the same source.
// Browser-specific manifest tweaks are handled via the `manifest` callback below.
//
// Single content script (in src/entrypoints/):
//   - content (isolated world): main logic, has chrome.* APIs
// HDRezka is a classic multi-page site (no SPA router patching window.history),
// so unlike the YouTube+RuTube sibling project, no MAIN-world page-world
// content script is required.
export default defineConfig({
  srcDir: 'src',
  zip: {
    excludeSources: [
      'dist-userscript/**',
      // Store-listing PNGs are uploaded separately to AMO/CWS as listing
      // assets; AMO's source zip only needs what's required to reproduce
      // the submitted build, not marketing collateral.
      'dist-store-assets/screenshots/**',
      // Playwright cache + per-run profile dirs left by the screenshot
      // generator. Not part of the source surface AMO needs.
      'tests/store-screenshots/.tmp-profile/**',
      'Ссылка для чаевых.txt',
    ],
  },
  // Mirror pkg.version into the bundle so SCRIPT_VERSION (which keys the
  // SelectorCache via script_version) is bumped automatically when
  // package.json is bumped.
  vite: () => ({
    define: {
      __VS_VERSION__: JSON.stringify(pkg.version),
    },
  }),
  manifest: ({ browser }) => ({
    name: 'HDRezka Speed Controller',
    description:
      'Adds speed buttons, slider, and hotkeys to HDRezka video player. Bilingual interface (English/Russian).',
    version: pkg.version,
    author: 'MaxScorpy',
    // - storage:   settings/presets/user mirrors in browser.storage.local.
    // - scripting: dynamic content-script registration for user-added
    //              mirror hosts (background reconcile).
    // - activeTab: lets the popup read the active tab's URL for the
    //              "Add current site as mirror" button (granted on toolbar
    //              click, no install-time warning).
    permissions: ['storage', 'scripting', 'activeTab'],
    // Full set of built-in HDRezka mirrors (src/sites/mirror-hosts.ts).
    host_permissions: builtinMatchPatterns(),
    // User-added mirrors are requested at runtime (permissions.request from
    // the popup, user-gesture-gated) — never granted silently at install.
    optional_host_permissions: ['*://*/*'],
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'hdrezka-speeds@maxscorpy',
              strict_min_version: '142.0',
              // The extension itself collects nothing automatically —
              // settings/presets stay in browser.storage.local. The
              // Send-feedback form (Settings -> Support -> Send
              // feedback) is fully opt-in: the user types a message,
              // optionally adds a contact handle and optionally
              // attaches a diagnostic snapshot (technical info), then
              // explicitly clicks Submit to POST the bundle to a
              // developer-owned Cloudflare Worker that forwards it to
              // the developer's personal Telegram. Per AMO data-
              // collection schema, that maps to:
              //   - required: ['none']         — nothing forced.
              //   - optional: personal comms (the message itself) +
              //               technicalAndInteraction (the diagnostic
              //               snapshot, only sent if the user checks
              //               the box). See PRIVACY.md.
              data_collection_permissions: {
                required: ['none'],
                optional: ['personalCommunications', 'technicalAndInteraction'],
              },
            },
          },
        }
      : {}),
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    action: {
      default_popup: 'popup.html',
      default_title: 'HDRezka Speed Controller',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
      },
    },
    // Defence-in-depth for the extension's own pages (popup / welcome /
    // feedback / the FF background event page). script-src + object-src 'self'
    // restate the MV3 default (the real XSS defence); connect-src is locked to
    // 'self' + the feedback worker + the built-in mirror hosts the background
    // probe reaches (see EXTENSION_PAGES_CSP above). default-src is omitted so
    // local img/font/style for welcome/popup stay unrestricted.
    content_security_policy: {
      extension_pages: EXTENSION_PAGES_CSP,
    },
  }),
});
