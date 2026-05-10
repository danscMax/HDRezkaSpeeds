/**
 * Renders Chrome Web Store / AMO listing screenshots for HDRezka Speeds.
 *
 * Produces:
 *   01-hdrezka-panel.jpg    — full mock HDRezka video page with the panel
 *   02-hdrezka-settings.jpg — same page with the settings modal open
 *   03-welcome-page.jpg     — extension's actual welcome.html
 *
 * All shots are 1280×800 (CWS recommended).
 *
 * How this works (v0.3.5+):
 *   1. Chromium is launched with the unpacked extension loaded as if the
 *      user installed it from a store.
 *   2. The mock-page.html in this folder contains ONLY the host-page
 *      chrome (HDRezka masthead, .b-player, dummy `<video>`) — no
 *      extension HTML, no extension CSS.
 *   3. Playwright intercepts all requests for a fake URL on rezka.ag
 *      (any path ending in `.html`) and serves mock-page.html as the
 *      response body. The browser sees the URL as rezka.ag/* — content
 *      scripts auto-fire because they match `*://rezka.ag/*`.
 *   4. The extension's content script bootstraps and injects its real
 *      `.vs-panel` into the page. Every new feature in src/ui (brand
 *      marker, pinned-speed dot, grouped preset chips, etc.) shows up
 *      automatically — no mock to keep in sync.
 *   5. For the settings shot, we click the gear button and wait for the
 *      menu to mount.
 *
 * Why a mock route rather than the real rezka.ag:
 *   - Living mirrors are unreachable from many headless setups (regional
 *     blocks, anti-bot, login walls).
 *   - The mock renders identically every run and ships in the repo.
 *
 * deviceScaleFactor stays at 1 — Chrome Web Store requires the
 * screenshot dimensions to match EXACTLY 1280×800. With DPR=2 the output
 * was 2560×1600 and CWS rejected it.
 *
 * Output is JPEG to satisfy CWS's "JPEG or 24-bit PNG (no alpha)" rule.
 */

import { chromium } from '@playwright/test';
import { mkdirSync, existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const OUT = resolve(REPO, 'dist-store-assets', 'screenshots');
const MOCK_PATH = resolve(__dirname, 'mock-page.html');
const EXT_DIR = resolve(REPO, '.output', 'chrome-mv3');

if (!existsSync(EXT_DIR)) {
  console.error(`Extension build missing: ${EXT_DIR}\nRun \`npm run build\` first.`);
  process.exit(1);
}

if (!existsSync(OUT)) {
  mkdirSync(OUT, { recursive: true });
} else {
  for (const f of readdirSync(OUT)) {
    if (/\.(png|jpe?g)$/i.test(f)) unlinkSync(join(OUT, f));
  }
  console.log(`cleaned ${OUT}`);
}

const MOCK_HTML = readFileSync(MOCK_PATH, 'utf-8');
// Real path that matches the URL allow-list (`*.html` under /films/).
const HOST_URL = 'https://rezka.ag/films/horror/12345-store-mock.html';

const userDataDir = resolve(__dirname, '.tmp-profile');
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [
    `--disable-extensions-except=${EXT_DIR}`,
    `--load-extension=${EXT_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    // Force English UI so the panel + modal i18n picks 'en'.
    // Store listings target an international audience, Russian copy
    // is a regression for non-RU users.
    '--lang=en-US',
  ],
  locale: 'en-US',
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
});

let n = 1;
async function shoot(page, name, opts = {}) {
  const file = join(OUT, `${String(n).padStart(2, '0')}-${name}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 92, ...opts });
  console.log(`saved ${file}`);
  n++;
}

/**
 * Set up route interception so requests for the rezka.ag mock URL are
 * fulfilled with our local HTML body. Every other URL on the same page
 * (CSS, fonts, images) gets aborted with no response — we don't load
 * any real assets.
 */
async function setupMockRoute(page) {
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url === HOST_URL) {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: MOCK_HTML,
      });
    } else if (url.startsWith('chrome-extension://') || url.startsWith('data:')) {
      // Let the extension's own resource fetches through.
      await route.continue();
    } else {
      // No real network — abort everything else (fonts, third-party
      // scripts the mock might inadvertently reference).
      await route.abort();
    }
  });
}

// 1. + 2. Live HDRezka render — panel and settings modal.
const page1 = await ctx.newPage();
await page1.setViewportSize({ width: 1280, height: 800 });
await setupMockRoute(page1);
await page1.goto(HOST_URL, { waitUntil: 'load' });
// Wait for the extension's content script to inject the panel.
await page1.waitForSelector('.vs-panel', { timeout: 15000 });
// Allow one rAF for the brand marker / animations to settle.
await page1.waitForTimeout(800);
await shoot(page1, 'hdrezka-panel');

// Open the settings menu via a real click on the gear button.
await page1.click('.vs-gear-button');
// Wait for the menu transition to finish (CSS animation ~200ms).
await page1.waitForSelector('.settings-menu.show, .settings-menu[aria-hidden="false"]', { timeout: 5000 }).catch(() => null);
await page1.waitForTimeout(400);
await shoot(page1, 'hdrezka-settings');

// 3. Welcome — through the built extension. Discover its ID via the service
// worker URL, then navigate to chrome-extension://<id>/welcome.html.
let extId = null;
for (let i = 0; i < 30 && !extId; i++) {
  const sw = ctx.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'));
  if (sw) {
    extId = new URL(sw.url()).host;
    break;
  }
  await new Promise((r) => setTimeout(r, 200));
}

if (extId) {
  const page4 = await ctx.newPage();
  await page4.setViewportSize({ width: 1280, height: 800 });
  await page4.emulateMedia({ colorScheme: 'light' });
  await page4.goto(`chrome-extension://${extId}/welcome.html`, { waitUntil: 'networkidle' });
  // Welcome runs a layout pass + draws SVG connectors via rAF.
  await page4.waitForTimeout(1500);
  await shoot(page4, 'welcome-page');
} else {
  console.warn('welcome-page skipped: extension service worker not found');
}

await ctx.close();

try {
  const { rmSync } = await import('node:fs');
  rmSync(userDataDir, { recursive: true, force: true });
} catch { /* swallow */ }

console.log(`\nAll screenshots in ${OUT}`);
