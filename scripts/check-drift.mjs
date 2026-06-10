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
 *   npm run drift -- --accept     # acknowledge current divergence as intentional
 *   node scripts/check-drift.mjs C:/path/to/twin
 *
 * Every drifted file is either ACKNOWLEDGED or UNEXPECTED. Files that
 * legitimately differ (site-specific wiring, per-product i18n/styles
 * content) are recorded in scripts/drift-baseline.json as a symmetric
 * pair-hash of both sides. An acknowledged file stays silent until
 * EITHER side changes again — then it reappears as unexpected drift and
 * must be re-reviewed (port the change to the twin, or re-accept).
 * There is deliberately NO permanent allow-list: every divergent file,
 * however routinely it churns, gets re-flagged on change so a real fix
 * (e.g. the 0.5.1 styles.ts polish) is never silently skipped.
 *
 * The pair-hash is order-independent and `--accept` writes the baseline
 * into BOTH checkouts, so the two copies of drift-baseline.json always
 * agree. Only check-drift.mjs itself still needs a manual copy to the
 * twin when the script changes.
 *
 * Exit code 0 always — this is an informational report, not a CI gate
 * (site-specific divergence inside shared files is sometimes legitimate).
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SELF_ROOT = resolve(__dirname, '..');
const SELF_NAME = basename(SELF_ROOT);
const TWIN_NAME = SELF_NAME === 'HDRezkaSpeeds' ? 'VideoSpeeds' : 'HDRezkaSpeeds';
const cliArgs = process.argv.slice(2);
const unknownFlag = cliArgs.find((a) => a.startsWith('-') && a !== '--accept');
if (unknownFlag) {
  console.error(`unknown flag: ${unknownFlag}`);
  console.error('usage: node scripts/check-drift.mjs [--accept] [path-to-twin]');
  process.exit(1);
}
const ACCEPT = cliArgs.includes('--accept');
const twinArg = cliArgs.find((a) => a !== '--accept');
const TWIN_ROOT = resolve(twinArg ?? join(SELF_ROOT, '..', TWIN_NAME));
const BASELINE_NAME = 'drift-baseline.json';
const BASELINE_PATH = join(__dirname, BASELINE_NAME);

// Shared core — directories whose files are expected to stay in lockstep.
// site-specific dirs (sites/, entrypoints/) are skipped: they legitimately
// diverge per product.
const SHARED_DIRS = ['src/app', 'src/discovery', 'src/health', 'src/speed', 'src/storage', 'src/ui', 'src/utils', 'src/i18n'];

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

// Order-independent hash of both sides' content hashes, so the baseline
// file is identical regardless of which checkout it was generated from.
// Re-hashing (instead of storing the sorted concatenation) halves the
// baseline's value size; debuggability is not lost — the report names
// the drifted file, and `git diff` against the twin shows the change.
function pairHash(hashA, hashB) {
  return createHash('sha256').update([hashA, hashB].sort().join('+')).digest('hex');
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  } catch {
    console.error(`warning: ${BASELINE_PATH} is unreadable — ignoring it.`);
    return {};
  }
}

const selfFiles = new Set(SHARED_DIRS.flatMap((d) => listFiles(SELF_ROOT, d)));
const twinFiles = new Set(SHARED_DIRS.flatMap((d) => listFiles(TWIN_ROOT, d)));

const baseline = loadBaseline();
const drifted = []; // { rel, pair, acknowledged }
const onlySelf = [];
const onlyTwin = [];
let identical = 0;

for (const rel of [...selfFiles].sort()) {
  if (!twinFiles.has(rel)) {
    onlySelf.push(rel);
    continue;
  }
  const selfHash = hashOf(join(SELF_ROOT, rel));
  const twinHash = hashOf(join(TWIN_ROOT, rel));
  if (selfHash === twinHash) {
    identical++;
  } else {
    const pair = pairHash(selfHash, twinHash);
    drifted.push({ rel, pair, acknowledged: baseline[rel] === pair });
  }
}
for (const rel of [...twinFiles].sort()) {
  if (!selfFiles.has(rel)) onlyTwin.push(rel);
}

const unexpected = drifted.filter((e) => !e.acknowledged);

if (ACCEPT) {
  // Acknowledge the CURRENT pair-state of every drifted file, dropping
  // stale entries (file no longer drifted, or no longer exists).
  // Re-running after either side changes flags the file again.
  const next = Object.fromEntries(drifted.map((e) => [e.rel, e.pair]).sort(([a], [b]) => a.localeCompare(b)));
  const json = `${JSON.stringify(next, null, 2)}\n`;
  // Write BOTH checkouts so the two baselines can never diverge.
  const twinBaselinePath = join(TWIN_ROOT, 'scripts', BASELINE_NAME);
  writeFileSync(BASELINE_PATH, json);
  writeFileSync(twinBaselinePath, json);
  console.log(`baseline updated: ${drifted.length} acknowledged file(s)`);
  console.log(`  → ${BASELINE_PATH}`);
  console.log(`  → ${twinBaselinePath}`);
  console.log('commit the baseline in both checkouts. (check-drift.mjs itself still needs a manual copy when the script changes.)');
  process.exit(0);
}

console.log(`drift report: ${SELF_NAME} vs ${TWIN_NAME}`);
console.log(`  identical shared files : ${identical}`);
console.log(`  drifted                : ${drifted.length}`);
for (const e of drifted) {
  console.log(`    ~ ${e.rel}${e.acknowledged ? ' (acknowledged)' : ''}`);
}
if (onlySelf.length) {
  console.log(`  only in ${SELF_NAME}:`);
  for (const rel of onlySelf) console.log(`    + ${rel}`);
}
if (onlyTwin.length) {
  console.log(`  only in ${TWIN_NAME}:`);
  for (const rel of onlyTwin) console.log(`    - ${rel}`);
}
console.log(
  unexpected.length
    ? `\n${unexpected.length} unexpectedly drifted file(s) — diff them before the next release, then port or \`npm run drift -- --accept\`.`
    : '\nshared core is in lockstep ✅ (modulo acknowledged divergence)',
);
