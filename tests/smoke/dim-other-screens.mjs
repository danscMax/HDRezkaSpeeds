#!/usr/bin/env node
/**
 * Live smoke for FEAT-020: entering fullscreen must cover every OTHER monitor
 * with a dim window, and leaving fullscreen must take them all away again.
 *
 *   npm run build && npm run test:smoke:dim
 *
 * Only meaningful on a multi-monitor machine — with one display attached the
 * feature is a deliberate no-op and the run reports SKIP (exit 0).
 *
 * Hard-won details, do not "simplify" them away:
 *   - headless:false is mandatory — Chromium ignores extensions in headless.
 *   - The install-time welcome tab steals focus and fullscreen is then denied;
 *     close stray tabs and bringToFront() first (same trap as the no-UI smoke).
 *   - The dim windows are extension pages, so they show up in ctx.pages() as
 *     chrome-extension://<id>/dim.html — that IS the assertion surface. Their
 *     screen placement can't be read from Playwright, only their existence,
 *     count and paint; the placement is what the human eyeballs on screen.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');

const MOCK_PATH = resolve(REPO, 'tests/store-screenshots/mock-page.html');
const HOST_URL = 'https://rezka.ag/films/horror/12345-store-mock.html';
const PLAYER_SELECTOR = '.b-player';
const SETTINGS_KEY = 'hdrezka-speed-settings';
const DIM_LEVEL = 85;

const EXT_DIR = resolve(REPO, '.output/chrome-mv3');
const SHOT_DIR = resolve(REPO, '.output/smoke');
const PROFILE_DIR = resolve(REPO, '.output/smoke-dim-profile');

const failures = [];
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    console.error(`  FAIL ${label} — ${detail}`);
    failures.push(label);
  }
}

const dimPages = (ctx) => ctx.pages().filter((p) => p.url().includes('/dim.html'));

mkdirSync(SHOT_DIR, { recursive: true });
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  args: [
    `--disable-extensions-except=${EXT_DIR}`,
    `--load-extension=${EXT_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--lang=en-US',
    '--window-size=1280,860',
  ],
  locale: 'en-US',
  viewport: null,
});

try {
  // Opt in BEFORE the content script boots. chrome.storage is unreachable from
  // a page's main world, so the write goes through one of our own extension
  // pages — the same blob the settings modal writes.
  const worker = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const extId = new URL(worker.url()).host;
  const optIn = await ctx.newPage();
  await optIn.goto(`chrome-extension://${extId}/popup.html`);
  await optIn.evaluate(
    async ([key, level]) => {
      const current = (await chrome.storage.local.get(key))[key] ?? {};
      await chrome.storage.local.set({
        [key]: { ...current, dimOtherScreens: true, dimLevel: level },
      });
    },
    [SETTINGS_KEY, DIM_LEVEL],
  );
  await optIn.close();

  const mockBody = readFileSync(MOCK_PATH, 'utf-8');
  const page = await ctx.newPage();
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url === HOST_URL) {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: mockBody });
    } else if (url.startsWith('chrome-extension://') || url.startsWith('data:')) {
      await route.continue();
    } else {
      await route.abort();
    }
  });
  await page.goto(HOST_URL, { waitUntil: 'load' });
  await page.waitForSelector('.vs-panel', { timeout: 20_000 });

  // The welcome tab (install) would steal focus → fullscreen denied.
  for (const other of ctx.pages()) if (other !== page) await other.close().catch(() => null);
  await page.bringToFront();

  // requestFullscreen needs a user gesture: click a real button.
  await page.evaluate((sel) => {
    const b = document.createElement('button');
    b.id = 'vs-smoke-fs';
    b.style.cssText = 'position:fixed;top:0;left:0;z-index:99999';
    b.onclick = () => {
      Promise.resolve(document.querySelector(sel)?.requestFullscreen()).catch((e) => {
        window.__vsFsError = String(e);
      });
    };
    document.body.appendChild(b);
  }, PLAYER_SELECTOR);
  await page.click('#vs-smoke-fs');
  await page.waitForTimeout(2500);

  const inFs = await page.evaluate(() => document.fullscreenElement != null);
  const fsError = await page.evaluate(() => window.__vsFsError ?? null);
  check('the page really entered fullscreen', inFs, `${fsError ?? 'no error reported'}`);

  const raised = dimPages(ctx);
  if (raised.length === 0) {
    console.log('\n  SKIP — no dim windows opened. On a single-monitor machine that is the');
    console.log('  correct behaviour; on a multi-monitor one it is a real failure.\n');
  } else {
    console.log(`  ${raised.length} dim window(s) opened`);
    // The whole feature is worthless if opening the overlays kicks the player
    // out of fullscreen — that's what `focused: false` is guarding against.
    check(
      'the player is STILL fullscreen after the overlays went up',
      await page.evaluate(() => document.fullscreenElement != null),
      'fullscreen was dropped when the dim windows opened',
    );
    const fill = await raised[0].evaluate(() => getComputedStyle(document.body).backgroundColor);
    // 85% → rgb(38, 38, 38); the level rides in the URL hash.
    check('dim window is filled at the configured level', fill === 'rgb(38, 38, 38)', fill);
    // Exact hash format on purpose: the page reads `l=`, and a stale format
    // silently falls back to the default level (which is how a wrong fill
    // once passed this suite unnoticed).
    check(
      'dim window carries the level in its URL',
      raised[0].url().endsWith(`#l=${DIM_LEVEL}`),
      raised[0].url(),
    );
    await raised[0]
      .screenshot({ path: join(SHOT_DIR, 'dim-overlay.png') })
      .catch(() => null);
  }

  // ── the two features have to coexist: dimming raises real browser windows
  //    and hands focus around, and the speed popup is the only feedback the
  //    hotkey gives in fullscreen. Neither had ever been exercised with the
  //    other switched on. ──
  await page.bringToFront();
  await page.keyboard.press('Alt+Period');
  await page.waitForTimeout(500);
  const feedback = await page.evaluate(() => {
    const el = document.getElementById('speed-popup');
    if (!el) return { present: false };
    const fs = document.fullscreenElement;
    const cs = getComputedStyle(el);
    return {
      present: true,
      insideFs: fs ? fs.contains(el) : null,
      display: cs.display,
      opacity: cs.opacity,
      text: el.textContent.trim(),
    };
  });
  check(
    'the hotkey still confirms the speed while the screens are dimmed',
    feedback.present && feedback.display !== 'none' && feedback.insideFs === true,
    JSON.stringify(feedback),
  );
  check(
    'raising the speed popup did not drop the player out of fullscreen',
    await page.evaluate(() => document.fullscreenElement != null),
    'fullscreen was lost when the popup appeared',
  );

  // ── leaving fullscreen must clear every overlay ──
  await page.evaluate(() => document.exitFullscreen()).catch(() => null);
  await page.waitForTimeout(2500);
  check(
    'all dim windows are gone after leaving fullscreen',
    dimPages(ctx).length === 0,
    `${dimPages(ctx).length} still open`,
  );
} finally {
  await ctx.close();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
