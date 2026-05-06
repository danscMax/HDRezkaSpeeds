/**
 * Vite config for the userscript build.
 *
 * Produces a single Tampermonkey-style .user.js file by reusing the same
 * src/ codebase the extension build uses.
 *
 * Run via `npm run build:userscript` -> `dist-userscript/hdrezka-speeds.user.js`.
 */

import { defineConfig } from 'vite';
import monkey, { cdn } from 'vite-plugin-monkey';
import { fileURLToPath } from 'node:url';
import pkg from './package.json' with { type: 'json' };

void cdn; // imported for type guidance; we don't use any @require CDNs (keep bundle self-contained)

export default defineConfig({
  resolve: {
    alias: {
      'wxt/browser': fileURLToPath(new URL('./src/userscript-shims/wxt-browser.ts', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist-userscript',
    emptyOutDir: true,
    target: 'es2022',
    minify: false,
  },
  plugins: [
    monkey({
      entry: 'src/userscript-entry.ts',
      userscript: {
        name: 'HDRezka Speed Controller',
        namespace: 'https://github.com/danscMax/HDRezkaSpeeds',
        version: pkg.version,
        description: pkg.description,
        author: 'MaxScorpy',
        license: 'GPL-3.0-or-later',
        match: [
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
        grant: [
          'GM_setValue',
          'GM_getValue',
          'GM_deleteValue',
          'GM_listValues',
        ],
        'run-at': 'document-idle',
      },
      build: {
        fileName: 'hdrezka-speeds.user.js',
      },
    }),
  ],
});
