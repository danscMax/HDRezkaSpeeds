/**
 * Render icon.svg into the four sizes WXT references in the manifest:
 * 16, 32, 48, 128 px. Output goes into public/icon/, overwriting the
 * stale icons that were copied verbatim from the VideoSpeeds project.
 *
 * Playwright is the only "image library" already in this repo, so we
 * use it as a tiny rasteriser: open the SVG inside a fixed-viewport
 * page, screenshot the whole page.
 */

import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const SVG = resolve(__dirname, 'icon.svg');
const OUT = resolve(REPO, 'public', 'icon');

mkdirSync(OUT, { recursive: true });

const svg = readFileSync(SVG, 'utf8');
const sizes = [16, 32, 48, 128];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 256, height: 256 } });
const page = await ctx.newPage();

for (const size of sizes) {
  // Wrap the SVG in a minimal HTML doc so the browser renders it as a
  // standalone image with a transparent background and the requested
  // pixel dimensions.
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; background: transparent; }
  body { width: ${size}px; height: ${size}px; }
  svg { display: block; width: 100%; height: 100%; }
</style></head><body>${svg}</body></html>`;

  await page.setViewportSize({ width: size, height: size });
  await page.setContent(html, { waitUntil: 'load' });
  // Settle a frame so the gradients and filter primitives are fully
  // composited before capture.
  await page.waitForTimeout(50);
  const buf = await page.screenshot({ omitBackground: true, type: 'png' });
  const file = resolve(OUT, `${size}.png`);
  writeFileSync(file, buf);
  console.log(`saved ${file} (${buf.length} bytes)`);
}

await browser.close();
