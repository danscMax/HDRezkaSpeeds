#!/usr/bin/env node
/**
 * Live smoke: the first-run hint — the ONE thing a new user sees before they
 * have learned anything — actually appears, is readable, and never comes back.
 *
 *   npm run build && npm run test:smoke:first-run
 *
 * Why this cannot be a unit test: "once per profile" is storage state in a real
 * extension context, and "readable" is a layout question — the chip plate is
 * capped at `max-width: min(80vw, 480px)`, so a hint of this length only fits
 * because its label is allowed to WRAP. It used to carry `white-space: nowrap`
 * (short toasts want that) and the sentence was clipped mid-word with the ✕
 * pushed off screen; that is the regression the overflow assertion guards.
 * jsdom has no layout and would call the clipped version fine.
 *
 * The profile is deleted on every run: a leftover profile has the flag set, the
 * hint never renders, and every assertion below would pass vacuously.
 *
 * Exit code 0 = all assertions held. Screenshot in .output/smoke/ (gitignored).
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');

// ── per-repo config (the only part that differs between the twins) ──
const MOCK_PATH = resolve(REPO, 'tests/store-screenshots/mock-page.html');
const HOST_URL = 'https://rezka.ag/films/horror/12345-store-mock.html';

const EXT_DIR = resolve(REPO, '.output/chrome-mv3');
const SHOT_DIR = resolve(REPO, '.output/smoke');
const PROFILE_DIR = resolve(REPO, '.output/smoke-first-run-profile');

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
// A clean profile is the whole point — see the header.
rmSync(PROFILE_DIR, { recursive: true, force: true });

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

/** What the stack holds, and whether the chip's text physically fits it. */
const probeChip = (page) =>
  page.evaluate(() => {
    const stack = document.getElementById('speed-notifications');
    const chip = stack?.firstElementChild ?? null;
    if (!chip) return { present: false, chips: stack ? stack.children.length : 0 };
    const rect = chip.getBoundingClientRect();
    return {
      present: true,
      chips: stack.children.length,
      text: chip.textContent.trim(),
      // Measure the CHIP, not the label: the label is a <span>, and a
      // non-replaced inline element reports clientWidth/scrollWidth 0, so
      // comparing those two always yields 0 and proves nothing. The chip is
      // inline-flex — a real box — and its scrollWidth grows past clientWidth
      // exactly when a nowrap child no longer fits.
      overflow: chip.scrollWidth - chip.clientWidth,
      offScreenRight: Math.round(rect.right - document.documentElement.clientWidth),
      width: Math.round(rect.width),
      dismissButtons: chip.querySelectorAll('button').length,
    };
  });

try {
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

  // The install-time welcome tab opens over ours; close it so the screenshot
  // shows what the user's film page really looks like.
  for (const other of ctx.pages()) if (other !== page) await other.close().catch(() => null);
  await page.bringToFront();

  // The hint is raised after the panel lands, behind a storage round-trip.
  await page
    .waitForFunction(() => document.getElementById('speed-notifications')?.children.length > 0, {
      timeout: 10_000,
    })
    .catch(() => null);

  const first = await probeChip(page);
  await page.screenshot({ path: join(SHOT_DIR, 'first-run-hint.png') });
  console.log('  first visit:', JSON.stringify(first));

  check('the hint appears on a clean profile', first.present, JSON.stringify(first));
  check(
    'the hint is the onboarding text, not some other toast',
    /Double-click/.test(first.text ?? ''),
    JSON.stringify(first.text),
  );
  check('the hint carries a dismiss control', (first.dismissButtons ?? 0) >= 1, JSON.stringify(first));
  check(
    'the hint text fits its plate (a long hint must wrap; nowrap clipped it)',
    first.overflow === 0,
    `chip content overflows its box by ${first.overflow}px — text is cut off`,
  );
  check(
    'the hint stays on screen',
    (first.offScreenRight ?? 1) <= 0,
    `chip runs ${first.offScreenRight}px past the right edge (width ${first.width})`,
  );
  check('exactly one chip, not a double raise', first.chips === 1, `${first.chips} chips`);

  // ── second visit, same profile: the flag must hold ──
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.vs-panel', { timeout: 20_000 });
  await page.waitForTimeout(2500);
  const second = await probeChip(page);
  console.log('  second visit:', JSON.stringify(second));
  check('the hint does NOT come back on the next page load', !second.present, JSON.stringify(second));

  await page.close();
} finally {
  await ctx.close();
}

if (failures.length) {
  console.error(`\nFAILED: ${failures.length} assertion(s) — ${failures.join('; ')}`);
  process.exit(1);
}
console.log('\nfirst-run smoke: all assertions held');
