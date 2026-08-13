/**
 * Records the demo clip for HDRezka Speeds.
 *
 *   node tools/promo-video.mjs        (needs `npm run build` first)
 *
 * Output: dist-store-assets/social/demo.mp4 — 1280x720, ~20s, no audio.
 *
 * Ported from the VideoSpeeds twin, which had the only copy of this. HDRezka
 * shipped a demo.gif captured 2026-07-11 and nothing since — before the
 * dimming feature, before the Russian name. The RU boards this add-on is
 * promoted on (Pikabu, 4PDA, Telegram) take mp4 natively and squeeze GIFs,
 * so the format is the useful one anyway.
 *
 * How it works — same trick as tests/store-screenshots/render.mjs: Chromium
 * runs with the unpacked extension, Playwright serves the local mock page
 * under the real rezka.ag URL so the content script fires, and the extension
 * injects its actual UI. Nothing here is a mock-up of the interface.
 *
 * Playwright writes webm per context; ffmpeg transcodes to mp4 (H.264 +
 * yuv420p, which is what every social preview accepts).
 */

import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const MOCKS = resolve(REPO, 'tests', 'store-screenshots');
const OUT_DIR = resolve(REPO, 'dist-store-assets', 'social');
const RAW_DIR = resolve(REPO, '.output', 'promo-video');
const EXT_DIR = resolve(REPO, '.output', 'chrome-mv3');
const OUT_MP4 = join(OUT_DIR, 'demo.mp4');

if (!existsSync(EXT_DIR)) {
  console.error(`Extension build missing: ${EXT_DIR}\nRun \`npm run build\` first.`);
  process.exit(1);
}

/** Real path matching the URL allow-list (`*.html` under /films/). */
const HOST_URL = 'https://rezka.ag/films/horror/12345-store-mock.html';
const MOCK_HTML = readFileSync(join(MOCKS, 'mock-page.html'), 'utf-8');

mkdirSync(OUT_DIR, { recursive: true });
rmSync(RAW_DIR, { recursive: true, force: true });
mkdirSync(RAW_DIR, { recursive: true });

const userDataDir = resolve(__dirname, '.tmp-promo-profile');
rmSync(userDataDir, { recursive: true, force: true });

const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [
    `--disable-extensions-except=${EXT_DIR}`,
    `--load-extension=${EXT_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--lang=en-US',
  ],
  locale: 'en-US',
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
  recordVideo: { dir: RAW_DIR, size: { width: 1280, height: 720 } },
});

// The extension opens welcome.html on install and takes focus. Playwright
// records ONE video per page, so that tab produces its own file — and picking
// "the first .webm in the directory" silently yielded a clip of the welcome
// page instead of the demo. Close it, and track our own page's video
// explicitly rather than by directory listing.
await new Promise((r) => setTimeout(r, 1500));
for (const p of ctx.pages()) {
  if (p.url().startsWith('chrome-extension://')) await p.close();
}

const page = await ctx.newPage();
await page.setViewportSize({ width: 1280, height: 720 });
await page.route('**/*', async (route) => {
  const url = route.request().url();
  if (url === HOST_URL) {
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: MOCK_HTML });
  } else if (url.startsWith('chrome-extension://') || url.startsWith('data:')) {
    await route.continue();
  } else {
    await route.abort();
  }
});

const beat = (ms = 1200) => page.waitForTimeout(ms);

/** Click a speed preset by its visible label, then let the toast be read. */
async function pressSpeed(label) {
  const button = page.locator('.vs-panel button', { hasText: new RegExp(`^${label}$`) }).first();
  await button.hover();
  await beat(400);
  await button.click();
  await beat(1600);
}

// 1. The player with the panel under it — the whole product in one frame.
await page.goto(HOST_URL, { waitUntil: 'load' });
await page.waitForSelector('.vs-panel', { timeout: 15000 });
// The first-run hint is right for a real new user and noise in a promo clip.
await page.evaluate(() => document.getElementById('speed-notifications')?.remove());
await beat(1800);

// 2. The 0.1 step, which is the pitch: HDRezka's own player jumps in coarse
// steps, and a film is watchable at 1.2 and gabbling at 1.5.
await pressSpeed('1\\.2x');
await pressSpeed('1\\.5x');

// 3. The slider, for values the buttons do not cover.
const slider = page.locator('.vs-panel input[type="range"]').first();
if (await slider.count()) {
  await slider.hover();
  await beat(400);
  const box = await slider.boundingBox();
  if (box) {
    // Drag across the track rather than setting the value: the fill and the
    // tooltip following the thumb are the point of showing it at all.
    //
    // Start AT the thumb (1.5x sits at ~67% of a 0.5-2.0 track) and drag up.
    // Grabbing the track further left first snapped the speed back down, so
    // the clip read 1.2 -> 1.5 -> 1.35: a demo of the product getting slower.
    await page.mouse.move(box.x + box.width * 0.67, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 67; i <= 90; i += 3) {
      await page.mouse.move(box.x + box.width * (i / 100), box.y + box.height / 2);
      await page.waitForTimeout(90);
    }
    await page.mouse.up();
    await beat(1400);
  }
}

// 4. Settings, then the dimming row — the one feature no competing extension
// has, and it sits below the fold, so a clip that stops at the panel shows
// everything EXCEPT the reason to install this one.
await page.click('.vs-gear-button');
await page
  .waitForSelector('.settings-menu.show, .settings-menu[aria-hidden="false"]', { timeout: 5000 })
  .catch(() => null);
await beat(1600);

// Scrolled to, never toggled: switching it live starts monitor calibration and
// opens real dim windows across the desktop, which has no business happening
// inside a recording. The toggle is an <input name="..."> inside .vs-toggle,
// NOT an element with that id — getElementById finds nothing and the scroll
// silently does not happen.
const dimScrolled = await page.evaluate(() => {
  const input = document.querySelector('.settings-menu input[name="dim-other-screens"]');
  const body = document.querySelector('.settings-menu .vs-menu-body');
  if (!input || !body) return false;
  const row = input.closest('label') ?? input;
  body.scrollTop += row.getBoundingClientRect().top - body.getBoundingClientRect().top - 90;
  return true;
});
if (!dimScrolled) {
  throw new Error('dimming row not found — the settings markup moved, fix the selector');
}
await beat(2400);

const video = page.video();
await page.close();
await ctx.close();
rmSync(userDataDir, { recursive: true, force: true });

const rawPath = video ? await video.path() : null;
if (!rawPath || !existsSync(rawPath)) {
  console.error('Playwright wrote no video for the demo page — nothing to transcode.');
  process.exit(1);
}
renameSync(rawPath, join(RAW_DIR, 'raw.webm'));

execFileSync(
  'ffmpeg',
  [
    '-y',
    '-i',
    join(RAW_DIR, 'raw.webm'),
    '-vf',
    'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x0f0f0f,fps=30',
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '23',
    // Required for the clip to play in Safari and in every in-feed preview.
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-an',
    OUT_MP4,
  ],
  { stdio: 'inherit' },
);

// The README embeds demo.gif, so a clip refreshed without it leaves the
// landing page showing an older product than the store does — which is exactly
// how the July GIF survived four releases. Derive one from the other in the
// same run and the two cannot drift apart.
execFileSync(
  'ffmpeg',
  [
    '-y',
    // Skip the first seconds: the page is still settling there and the panel
    // sits clipped at the bottom edge. A GIF's first frame is what a README
    // shows before it plays, so that frame has to be the finished layout.
    '-ss',
    '3',
    '-i',
    OUT_MP4,
    '-vf',
    'fps=12,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=3',
    join(OUT_DIR, 'demo.gif'),
  ],
  { stdio: 'inherit' },
);

const probe = execFileSync('ffprobe', [
  '-v',
  'error',
  '-show_entries',
  'format=duration,size',
  '-of',
  'default=noprint_wrappers=1',
  OUT_MP4,
]).toString();
console.log(`\nwrote ${OUT_MP4}\n${probe}`);
