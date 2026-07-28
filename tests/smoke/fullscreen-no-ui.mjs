#!/usr/bin/env node
/**
 * Live smoke: the extension must show NO UI of its own in fullscreen.
 *
 * Runs the REAL build in a REAL Chromium against the offline mock page, so it
 * catches what jsdom cannot: whether the browser actually paints our panel,
 * whether a stylesheet rule really matches, whether the toast stack survives.
 *
 *   npm run build && npm run test:smoke:fullscreen
 *
 * Exit code 0 = all assertions held. Screenshots land in .output/smoke/
 * (gitignored) for eyeballing.
 *
 * Hard-won details, do not "simplify" them away:
 *   - headless:false is mandatory — Chromium ignores extensions in headless.
 *   - The extension opens welcome.html on install and STEALS FOCUS; Chrome then
 *     rejects requestFullscreen with "TypeError: not granted". Close stray tabs
 *     and bringToFront() before asking for fullscreen.
 *   - page.screenshot() does not always capture the fullscreen presentation —
 *     assert on the DOM (inFsSubtree / computed display), treat the PNG as a
 *     human aid, not as the check.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');

// ── per-repo config (this is the only part that differs between the twins) ──
const CONFIG = {
  mockPath: resolve(REPO, 'tests/store-screenshots/mock-page.html'),
  hostUrl: 'https://rezka.ag/films/horror/12345-store-mock.html',
  /** Element the site puts into fullscreen. */
  playerSelector: '.b-player',
};

const EXT_DIR = resolve(REPO, '.output/chrome-mv3');
const SHOT_DIR = resolve(REPO, '.output/smoke');
const PROFILE_DIR = resolve(REPO, '.output/smoke-profile');

const failures = [];
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    console.error(`  FAIL ${label} — ${detail}`);
    failures.push(label);
  }
}

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
  const mockBody = readFileSync(CONFIG.mockPath, 'utf-8');
  const page = await ctx.newPage();
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url === CONFIG.hostUrl) {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: mockBody });
    } else if (url.startsWith('chrome-extension://') || url.startsWith('data:')) {
      await route.continue();
    } else {
      await route.abort();
    }
  });
  await page.goto(CONFIG.hostUrl, { waitUntil: 'load' });
  await page.waitForSelector('.vs-panel', { timeout: 20_000 });

  // The install-time welcome tab steals focus → fullscreen would be denied.
  for (const other of ctx.pages()) if (other !== page) await other.close().catch(() => null);
  await page.bringToFront();

  const probe = () =>
    page.evaluate((playerSelector) => {
      const state = (el) => {
        if (!el) return { present: false };
        return {
          present: true,
          display: getComputedStyle(el).display,
          inFsSubtree: document.fullscreenElement
            ? document.fullscreenElement.contains(el)
            : null,
        };
      };
      return {
        fullscreen: document.fullscreenElement
          ? document.fullscreenElement.id || document.fullscreenElement.className
          : null,
        player: !!document.querySelector(playerSelector),
        panel: state(document.querySelector('.vs-panel')),
        popup: state(document.getElementById('speed-popup')),
        stack: state(document.getElementById('speed-notifications')),
        slider: state(document.querySelector('.vs-slider-in-chrome')),
      };
    }, CONFIG.playerSelector);

  // Bring the transient surfaces into existence BEFORE fullscreen, so the run
  // also covers the teardown path and not just "never created".
  await page.click('.speed-button:nth-child(6)').catch(() => null);
  await page.dblclick('.speed-button:nth-child(4)').catch(() => null);
  await page.waitForTimeout(500);

  const before = await probe();
  await page.screenshot({ path: join(SHOT_DIR, 'fullscreen-01-normal.png') });
  console.log('before fullscreen:', JSON.stringify(before));
  check('panel is visible outside fullscreen', before.panel.present, JSON.stringify(before.panel));
  check('toast stack was created outside fullscreen', before.stack.present, 'no stack — the run would not prove the teardown path');

  // requestFullscreen needs a user gesture: click a real button.
  await page.evaluate((playerSelector) => {
    const b = document.createElement('button');
    b.id = 'vs-smoke-fs';
    b.style.cssText = 'position:fixed;top:0;left:0;z-index:99999';
    b.onclick = () => {
      Promise.resolve(document.querySelector(playerSelector)?.requestFullscreen()).catch((e) => {
        window.__vsFsError = String(e);
      });
    };
    document.body.appendChild(b);
  }, CONFIG.playerSelector);
  await page.click('#vs-smoke-fs');
  await page.waitForTimeout(1500);

  const inFs = await probe();
  await page.screenshot({ path: join(SHOT_DIR, 'fullscreen-02-fullscreen.png') });
  console.log('in fullscreen:', JSON.stringify(inFs));
  const fsError = await page.evaluate(() => window.__vsFsError ?? null);
  check('the page really entered fullscreen', inFs.fullscreen != null, `fullscreenElement is null (${fsError ?? 'no error reported'}) — focus stolen by another tab?`);

  const hidden = (s) => !s.present || s.display === 'none' || s.inFsSubtree === false;
  check('panel is not rendered in fullscreen', hidden(inFs.panel), JSON.stringify(inFs.panel));
  check('speed popup is not rendered in fullscreen', hidden(inFs.popup), JSON.stringify(inFs.popup));
  check('in-chrome slider is not rendered in fullscreen', hidden(inFs.slider), JSON.stringify(inFs.slider));
  check('toast stack was torn down on entering fullscreen', !inFs.stack.present, JSON.stringify(inFs.stack));

  // A toast raised WHILE fullscreen is active must not appear either.
  await page.dblclick('.speed-button:nth-child(5)').catch(() => null);
  await page.waitForTimeout(600);
  const afterToast = await probe();
  check('a toast raised in fullscreen does not appear', !afterToast.stack.present, JSON.stringify(afterToast.stack));

  await page.evaluate(() => document.exitFullscreen()).catch(() => null);
  await page.waitForTimeout(1500);
  const after = await probe();
  await page.screenshot({ path: join(SHOT_DIR, 'fullscreen-03-exited.png') });
  console.log('after exit:', JSON.stringify(after));
  check('fullscreen was left', after.fullscreen == null, JSON.stringify(after.fullscreen));
  check('panel is back after leaving fullscreen', after.panel.present && after.panel.display !== 'none', JSON.stringify(after.panel));
} finally {
  await ctx.close();
}

if (failures.length) {
  console.error(`\nFAILED: ${failures.length} assertion(s) — ${failures.join('; ')}`);
  process.exit(1);
}
console.log('\nfullscreen smoke: all assertions held');
