import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';

// ESM context — derive __dirname manually (package.json has "type": "module").
const __dirname = dirname(fileURLToPath(import.meta.url));

// Smoke: extension loads, content script runs on HDRezka, prints sanity log.
//
// Why we copy the build to a tmp ASCII path:
//   the project lives at E:\Scripts\Расширения\HDRezkaSpeeds — Chrome's
//   --load-extension= flag rejects Cyrillic in the path on Windows.
//   We sidestep this by copying .output/chrome-mv3/ into an ASCII tmpdir
//   (e.g. C:\Users\<u>\AppData\Local\Temp\hd-ext-<rand>) before launching.
//   Linux/macOS CI runners don't need the workaround but the copy is cheap
//   so we always do it — keeps the test deterministic across hosts.

const REPO_ROOT = resolve(__dirname, '..', '..');
const BUILD_DIR = resolve(REPO_ROOT, '.output', 'chrome-mv3');

test.describe('extension smoke', () => {
  test.skip(
    !existsSync(BUILD_DIR),
    `Build output missing at ${BUILD_DIR} — run "npx wxt build" first.`,
  );

  test('content script logs init banner on hdrezka.ag', async () => {
    const profileDir = mkdtempSync(join(tmpdir(), 'hd-pw-profile-'));
    const extDir = mkdtempSync(join(tmpdir(), 'hd-ext-'));
    cpSync(BUILD_DIR, extDir, { recursive: true });

    const ctx = await chromium.launchPersistentContext(profileDir, {
      headless: false, // chromium ignores extensions in headless mode
      args: [
        `--disable-extensions-except=${extDir}`,
        `--load-extension=${extDir}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });

    try {
      const page = await ctx.newPage();
      const logs: string[] = [];
      page.on('console', (msg) => logs.push(msg.text()));

      await page.goto('https://hdrezka.ag/', {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      // content_scripts run at document_idle, which on a slow runner can
      // land well past a fixed 4 s pause — poll for the banner instead.
      const deadline = Date.now() + 25_000;
      let initBanner: string | undefined;
      while (!initBanner && Date.now() < deadline) {
        initBanner = logs.find((l) => l.includes('[HDREZKA-SPEEDS]'));
        if (!initBanner) await page.waitForTimeout(500);
      }
      expect(initBanner, `expected [HDREZKA-SPEEDS] log, saw:\n${logs.join('\n')}`).toBeDefined();
    } finally {
      await ctx.close();
      try {
        rmSync(profileDir, { recursive: true, force: true });
        rmSync(extDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup; tmpdir reaper will get it eventually
      }
    }
  });
});
