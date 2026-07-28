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
 * Two fullscreen flavours are covered per scenario:
 *   A. native  — Element.requestFullscreen(); the browser paints only the
 *      fullscreen subtree, so our sibling panel is off-screen for free.
 *   B. Plyr's CSS-only pseudo-fullscreen — no fullscreenElement and no
 *      fullscreenchange event, so it is carried entirely by the
 *      `.plyr--fullscreen-fallback` matcher in styles.ts plus the class sniff
 *      in ui/notifications.ts.
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

// ── per-repo config (the only part that differs between the twins) ──
const SCENARIOS = [
  {
    name: 'hdrezka',
    mockPath: resolve(REPO, 'tests/store-screenshots/mock-page.html'),
    hostUrl: 'https://rezka.ag/films/horror/12345-store-mock.html',
    /** Element the site puts into fullscreen. */
    playerSelector: '.b-player',
  },
];

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

/** Hidden = absent, display:none, or outside the painted fullscreen subtree. */
const hidden = (s) => !s.present || s.display === 'none' || s.inFsSubtree === false;

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
  for (const scenario of SCENARIOS) {
    console.log(`\n── scenario: ${scenario.name} ──`);
    const mockBody = readFileSync(scenario.mockPath, 'utf-8');
    const page = await ctx.newPage();
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (url === scenario.hostUrl) {
        await route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: mockBody,
        });
      } else if (url.startsWith('chrome-extension://') || url.startsWith('data:')) {
        await route.continue();
      } else {
        await route.abort();
      }
    });
    await page.goto(scenario.hostUrl, { waitUntil: 'load' });
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
      }, scenario.playerSelector);

    const shot = (label) => page.screenshot({ path: join(SHOT_DIR, `${scenario.name}-${label}.png`) });

    check(`[${scenario.name}] the mock page really has ${scenario.playerSelector}`, (await probe()).player, 'player element missing — the mock page changed?');

    // Bring the transient surfaces into existence BEFORE fullscreen, so the run
    // also covers the teardown path and not just "never created".
    await page.click('.speed-button:nth-child(6)').catch(() => null);
    await page.dblclick('.speed-button:nth-child(4)').catch(() => null);
    await page.waitForTimeout(500);

    const before = await probe();
    await shot('01-normal');
    console.log('  before fullscreen:', JSON.stringify(before));
    check(`[${scenario.name}] panel is visible outside fullscreen`, before.panel.present, JSON.stringify(before.panel));
    check(`[${scenario.name}] toast stack was created outside fullscreen`, before.stack.present, 'no stack — the run would not prove the teardown path');

    // ── A. native fullscreen ──────────────────────────────────────────────
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
    }, scenario.playerSelector);
    await page.click('#vs-smoke-fs');
    await page.waitForTimeout(1500);

    const inFs = await probe();
    await shot('02-native-fullscreen');
    console.log('  in native fullscreen:', JSON.stringify(inFs));
    const fsError = await page.evaluate(() => window.__vsFsError ?? null);
    check(`[${scenario.name}] the page really entered fullscreen`, inFs.fullscreen != null, `fullscreenElement is null (${fsError ?? 'no error reported'}) — focus stolen by another tab?`);
    check(`[${scenario.name}] panel is not rendered in fullscreen`, hidden(inFs.panel), JSON.stringify(inFs.panel));
    check(`[${scenario.name}] speed popup is not rendered in fullscreen`, hidden(inFs.popup), JSON.stringify(inFs.popup));
    check(`[${scenario.name}] in-chrome slider is not rendered in fullscreen`, hidden(inFs.slider), JSON.stringify(inFs.slider));
    check(`[${scenario.name}] toast stack was torn down on entering fullscreen`, !inFs.stack.present, JSON.stringify(inFs.stack));

    // A toast raised WHILE fullscreen is active must not appear either.
    await page.dblclick('.speed-button:nth-child(5)').catch(() => null);
    await page.waitForTimeout(600);
    check(`[${scenario.name}] a toast raised in fullscreen does not appear`, !(await probe()).stack.present, 'a stack was built while fullscreen');

    await page.evaluate(() => document.exitFullscreen()).catch(() => null);
    await page.waitForTimeout(1500);
    const after = await probe();
    await shot('03-exited');
    console.log('  after exit:', JSON.stringify(after));
    check(`[${scenario.name}] fullscreen was left`, after.fullscreen == null, JSON.stringify(after.fullscreen));
    check(`[${scenario.name}] panel is back after leaving fullscreen`, after.panel.present && after.panel.display !== 'none', JSON.stringify(after.panel));

    // ── B. Plyr CSS-only pseudo-fullscreen ────────────────────────────────
    // No fullscreenElement, no event: this path is carried by the
    // .plyr--fullscreen-fallback matcher in the stylesheet and by the class
    // sniff in notifications.ts. Verified here because a unit test cannot say
    // whether the selector actually matches in a browser.
    await page.click('.speed-button:nth-child(6)').catch(() => null); // repaint the popup
    await page.waitForTimeout(300);
    await page.evaluate((playerSelector) => {
      document.querySelector(playerSelector)?.classList.add('plyr--fullscreen-fallback');
    }, scenario.playerSelector);
    await page.waitForTimeout(300);
    const inFallback = await probe();
    await shot('04-plyr-fallback');
    console.log('  in Plyr fallback:', JSON.stringify(inFallback));
    check(`[${scenario.name}] speed popup is hidden in Plyr pseudo-fullscreen`, hidden(inFallback.popup), JSON.stringify(inFallback.popup));
    check(`[${scenario.name}] in-chrome slider is hidden in Plyr pseudo-fullscreen`, hidden(inFallback.slider), JSON.stringify(inFallback.slider));

    await page.dblclick('.speed-button:nth-child(4)').catch(() => null);
    await page.waitForTimeout(600);
    check(`[${scenario.name}] a toast raised in Plyr pseudo-fullscreen does not appear`, !(await probe()).stack.present, 'a stack was built during the CSS-only fullscreen');

    await page.evaluate((playerSelector) => {
      document.querySelector(playerSelector)?.classList.remove('plyr--fullscreen-fallback');
    }, scenario.playerSelector);
    await page.waitForTimeout(400);
    const restored = await probe();
    await shot('05-fallback-exited');
    check(`[${scenario.name}] popup works again after leaving the CSS-only fullscreen`, restored.popup.present && restored.popup.display !== 'none', JSON.stringify(restored.popup));

    await page.close();
  }
} finally {
  await ctx.close();
}

if (failures.length) {
  console.error(`\nFAILED: ${failures.length} assertion(s) — ${failures.join('; ')}`);
  process.exit(1);
}
console.log('\nfullscreen smoke: all assertions held');
