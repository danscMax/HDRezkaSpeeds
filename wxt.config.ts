import { defineConfig } from 'wxt';
import pkg from './package.json' with { type: 'json' };

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
    permissions: ['storage'],
    // Full set of HDRezka mirrors known from the original userscript.
    host_permissions: [
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
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'hdrezka-speeds@maxscorpy',
              strict_min_version: '142.0',
              data_collection_permissions: { required: ['none'] },
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
  }),
});
