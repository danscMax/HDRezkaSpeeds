#!/usr/bin/env node
/**
 * FEAT-040: twin-drift checker.
 *
 * HDRezkaSpeeds and VideoSpeeds share ~85% of src/ by copy-paste. This
 * script diffs the shared modules between the two checkouts and reports
 * files that have drifted, so a fix landed in one twin is consciously
 * ported (or consciously skipped) instead of silently forgotten.
 *
 * Usage:
 *   npm run drift                 # sibling checkout assumed at ../<twin>
 *   node scripts/check-drift.mjs C:/path/to/twin
 *
 * Exit code 0 always — this is an informational report, not a CI gate
 * (site-specific divergence inside shared files is sometimes legitimate).
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SELF_ROOT = resolve(__dirname, '..');
const SELF_NAME = basename(SELF_ROOT);
const TWIN_NAME = SELF_NAME === 'HDRezkaSpeeds' ? 'VideoSpeeds' : 'HDRezkaSpeeds';
const TWIN_ROOT = resolve(process.argv[2] ?? join(SELF_ROOT, '..', TWIN_NAME));

// Shared core — directories whose files are expected to stay in lockstep.
// site-specific dirs (sites/, entrypoints/) are skipped: they legitimately
// diverge per product.
const SHARED_DIRS = ['src/app', 'src/discovery', 'src/health', 'src/speed', 'src/storage', 'src/ui', 'src/utils', 'src/i18n'];
// Files that are shared in spirit but contain per-product content.
const EXPECTED_DIVERGENT = new Set(['src/i18n/dict.ts', 'src/ui/styles.ts', 'src/storage/mirrors-store.ts', 'src/ui/settings/mirrors-block.ts', 'src/sites/mirror-hosts.ts']);

if (!existsSync(TWIN_ROOT)) {
  console.error(`twin checkout not found: ${TWIN_ROOT}`);
  console.error('pass the path explicitly: node scripts/check-drift.mjs <path-to-twin>');
  process.exit(0);
}

function listFiles(root, rel) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return [];
  const out = [];
  for (const entry of readdirSync(abs)) {
    const childRel = `${rel}/${entry}`;
    const childAbs = join(root, childRel);
    if (statSync(childAbs).isDirectory()) out.push(...listFiles(root, childRel));
    else out.push(childRel);
  }
  return out;
}

function hashOf(absPath) {
  // Normalise line endings so a CRLF/LF checkout difference is not "drift".
  const text = readFileSync(absPath, 'utf8').replace(/\r\n/g, '\n');
  return createHash('sha256').update(text).digest('hex');
}

const selfFiles = new Set(SHARED_DIRS.flatMap((d) => listFiles(SELF_ROOT, d)));
const twinFiles = new Set(SHARED_DIRS.flatMap((d) => listFiles(TWIN_ROOT, d)));

const drifted = [];
const onlySelf = [];
const onlyTwin = [];
let identical = 0;

for (const rel of [...selfFiles].sort()) {
  if (!twinFiles.has(rel)) {
    onlySelf.push(rel);
    continue;
  }
  if (hashOf(join(SELF_ROOT, rel)) === hashOf(join(TWIN_ROOT, rel))) identical++;
  else drifted.push(rel);
}
for (const rel of [...twinFiles].sort()) {
  if (!selfFiles.has(rel)) onlyTwin.push(rel);
}

console.log(`drift report: ${SELF_NAME} vs ${TWIN_NAME}`);
console.log(`  identical shared files : ${identical}`);
console.log(`  drifted                : ${drifted.length}`);
for (const rel of drifted) {
  const marker = EXPECTED_DIVERGENT.has(rel) ? ' (expected divergence)' : '';
  console.log(`    ~ ${rel}${marker}`);
}
if (onlySelf.length) {
  console.log(`  only in ${SELF_NAME}:`);
  for (const rel of onlySelf) console.log(`    + ${rel}`);
}
if (onlyTwin.length) {
  console.log(`  only in ${TWIN_NAME}:`);
  for (const rel of onlyTwin) console.log(`    - ${rel}`);
}
const unexpected = drifted.filter((rel) => !EXPECTED_DIVERGENT.has(rel));
console.log(
  unexpected.length
    ? `\n${unexpected.length} unexpectedly drifted file(s) — diff them before the next release.`
    : '\nshared core is in lockstep ✅',
);
