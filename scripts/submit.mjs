/**
 * Send the built artifacts of the CURRENT version to both stores.
 *
 *   npm run submit          — upload + submit for review
 *   npm run submit:check    — same, but --dry-run (only checks credentials)
 *   npm run submit:status   — ask the stores what is live and what is pending
 *
 * Why a script and not a plain npm script: the zip names carry the version, and
 * `$npm_package_version` is a shell variable that Windows' cmd.exe does not
 * expand — the same line that works in bash silently looked for a file called
 * `...-$npm_package_version-chrome.zip`. Reading package.json here works the
 * same everywhere.
 *
 * Credentials live in .env.submit (gitignored; master copy in the secrets file
 * on OneDrive). Chrome uses the v2 API with a service account — no refresh
 * token to expire.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
// Relative, not absolute: the checkout lives under a path with a space in it
// ("Browser extensions"), and the CLI is spawned through a shell, which would
// split an absolute path into three arguments it then rejects as unused.
const zip = (kind) => `.output/${pkg.name}-${pkg.version}-${kind}.zip`;

const missing = ['chrome', 'firefox', 'sources'].filter((k) => !existsSync(join(root, zip(k))));
if (missing.length > 0) {
  console.error(`missing artifacts for ${pkg.version}: ${missing.join(', ')}`);
  console.error('build them first: npm run zip && npm run zip:firefox');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');
const noNotes = process.argv.includes('--no-notes');

// Checked HERE, not only inside submit-amo.mjs: Chrome uploads first, so a
// missing-notes abort further down would leave Chrome live and Firefox behind —
// the two stores out of step, which is worse than not shipping at all.
const notesFile = join(root, 'dist-store-assets', 'release-notes', `${pkg.version}.md`);
if (!dryRun && !noNotes && !existsSync(notesFile)) {
  console.error(`no release notes at ${notesFile}`);
  console.error('write them (RU, then ---, then EN — see 0.6.5.md), or pass --no-notes on purpose');
  process.exit(1);
}

// Chrome goes through the CLI — that half works.
const args = [
  'publish-extension',
  '--chrome-api-version',
  'v2',
  '--chrome-zip',
  zip('chrome'),
  // Our own flags are not the CLI's — passing them through makes it complain
  // about unused arguments.
  ...process.argv.slice(2).filter((a) => a !== '--no-notes'),
];

console.log(`submitting ${pkg.name} ${pkg.version}`);
const chrome = spawnSync('npx', args, { cwd: root, stdio: 'inherit', shell: true });
if (chrome.status !== 0) process.exit(chrome.status ?? 1);

// Firefox does NOT: publish-browser-extension@6 rejects a perfectly good
// sources .zip with "Unsupported file type" and mislabels a valid upload as
// "1 error" (verified against AMO's own upload records, 2026-08-05). Our own
// API call does the same job — see scripts/submit-amo.mjs.
if (dryRun) {
  console.log('dry run: skipping the AMO upload (credentials are checked by the Chrome step)');
  process.exit(0);
}
const amo = spawnSync('node', ['scripts/submit-amo.mjs', ...(noNotes ? ['--no-notes'] : [])], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});
process.exit(amo.status ?? 1);
