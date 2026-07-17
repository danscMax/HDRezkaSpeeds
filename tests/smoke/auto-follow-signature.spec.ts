import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BrowserContext, chromium, expect, test } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const BUILD_DIR = resolve(REPO_ROOT, '.output', 'chrome-mv3');

// E2E for the auto-follow content signature (part B). We can't reach a live
// mirror from CI (login walls + geo/DNS blocks — the very problem the feature
// solves), so instead we prove the deciding path in a real Chromium with the
// real built extension: the content script, injected on a host the manifest
// does NOT know by name (localhost), activates ONLY when the page carries
// HDRezka's DOM signature, and self-bails otherwise.
//
// Signal: bootstrap's coexistence claim sets `data-vs-ext-active="1"` on
// <html> (utils/tm-coexist.detectAndClaim), which runs at step 1 — right after
// the step-0 signature gate. So the attribute's presence is a page-observable
// proof that looksLikeHDRezka() passed and bootstrap proceeded. Absent = the
// script self-bailed as "unsupported host".
//
// We isolate the signature gate: the copied manifest gets `http://localhost/*`
// added to content_scripts.matches + host_permissions so the script injects on
// our mock host. The dynamic broad registration the popup toggle drives in
// production uses the same `scripting.registerContentScripts` already shipped
// for user mirrors; this test targets the NEW decision (the signature gate),
// which fires under exactly the condition the broad script creates.

const EXT_MARKER = 'data-vs-ext-active';

const REZKA_MOCK = `<!doctype html><html><head><title>Mock mirror</title></head>
<body>
  <div class="b-content__main">
    <div class="b-post__info">info</div>
    <div id="player" class="b-player">
      <div id="oframecdnplayer"><video></video></div>
    </div>
  </div>
</body></html>`;

const PLAIN_MOCK = `<!doctype html><html><head><title>Not rezka</title></head>
<body><main><h1>Just a page</h1><video></video></main></body></html>`;

function loadPatchedExtension(): { extDir: string; profileDir: string } {
  const profileDir = mkdtempSync(join(tmpdir(), 'hd-af-profile-'));
  const extDir = mkdtempSync(join(tmpdir(), 'hd-af-ext-'));
  cpSync(BUILD_DIR, extDir, { recursive: true });
  // Let the content script run on our local mock host so the signature gate is
  // reached on a non-built-in host (the auto-follow condition).
  const manifestPath = join(extDir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.host_permissions.push('http://localhost/*');
  manifest.content_scripts[0].matches.push('http://localhost/*');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return { extDir, profileDir };
}

async function launch(profileDir: string, extDir: string): Promise<BrowserContext> {
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false, // chromium ignores extensions in headless mode
    args: [
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
  // Fulfil only our mock host — don't touch anything else the browser fetches.
  await ctx.route('http://localhost/**', (route) => {
    const body = route.request().url().includes('/plain/') ? PLAIN_MOCK : REZKA_MOCK;
    return route.fulfill({ contentType: 'text/html', body });
  });
  return ctx;
}

function markerAttr(): string | null {
  return document.documentElement.getAttribute('data-vs-ext-active');
}

test.describe('auto-follow content signature', () => {
  test.skip(
    !existsSync(BUILD_DIR),
    `Build output missing at ${BUILD_DIR} — run "npm run build" first.`,
  );

  test('activates on a signed rezka page and self-bails on a plain page (non-built-in host)', async () => {
    const { extDir, profileDir } = loadPatchedExtension();
    const ctx = await launch(profileDir, extDir);
    try {
      // Extension must actually load (MV3 background SW present).
      if (ctx.serviceWorkers().length === 0) {
        await ctx.waitForEvent('serviceworker', { timeout: 15_000 });
      }
      expect(ctx.serviceWorkers().length).toBeGreaterThan(0);

      const page = await ctx.newPage();

      // Positive: rezka DOM signature on a non-built-in host -> bootstrap claims.
      await page.goto('http://localhost/films/99999-mock.html', {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      await page.waitForFunction(
        (attr) => document.documentElement.hasAttribute(attr),
        EXT_MARKER,
        {
          timeout: 25_000,
        },
      );
      expect(await page.evaluate(markerAttr)).toBe('1');

      // Negative: no signature -> self-bail. Wait past the 3s signature budget,
      // then confirm the marker never appears.
      await page.goto('http://localhost/plain/page.html', {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      await page.waitForTimeout(5_000);
      expect(await page.evaluate(markerAttr)).toBeNull();
    } finally {
      await ctx.close();
      try {
        rmSync(profileDir, { recursive: true, force: true });
        rmSync(extDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  });
});
