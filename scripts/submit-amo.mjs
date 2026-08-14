/**
 * Upload the current version to addons.mozilla.org ourselves.
 *
 * Why not publish-browser-extension: its Firefox path fails the source-code
 * step with `{"source":["Unsupported file type, please upload an archive
 * file (.zip, …)"]}` on a plain .zip, and the same run mislabels a valid
 * upload as "1 error". Verified 2026-08-05 against AMO's own upload records
 * (validation: valid=true, errors=0) — the artifacts are fine, the tool's
 * multipart for the `source` field is not. Chrome still goes through the CLI.
 *
 * Release notes: dist-store-assets/release-notes/<version>.md (optional).
 * Reviewer notes: dist-store-assets/release-notes/reviewer.md (optional).
 * Credentials: .env.submit (gitignored).
 */

import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const zipPath = (kind) => join(root, '.output', `${pkg.name}-${pkg.version}-${kind}.zip`);

const env = Object.fromEntries(
  readFileSync(join(root, '.env.submit'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [
        l.slice(0, i).trim(),
        l
          .slice(i + 1)
          .trim()
          .replace(/^"|"$/g, ''),
      ];
    }),
);

for (const key of ['FIREFOX_EXTENSION_ID', 'FIREFOX_JWT_ISSUER', 'FIREFOX_JWT_SECRET']) {
  if (!env[key]) {
    console.error(`missing ${key} in .env.submit`);
    process.exit(1);
  }
}
for (const kind of ['firefox', 'sources']) {
  if (!existsSync(zipPath(kind))) {
    console.error(`missing artifact: ${zipPath(kind)} — run npm run zip:firefox first`);
    process.exit(1);
  }
}

const notesDir = join(root, 'dist-store-assets', 'release-notes');
const notesFile = join(notesDir, `${pkg.version}.md`);
const reviewerFile = join(notesDir, 'reviewer.md');

// Checked here, before anything is uploaded: a version published with an empty
// "What's new" cannot be fixed by re-running this script — the version already
// exists, and the notes then have to be PATCHed onto it by hand. That happened
// on 0.6.6 precisely because a warning scrolled past inside a green run.
if (!existsSync(notesFile) && !process.argv.includes('--no-notes')) {
  console.error(`no release notes at ${notesFile}`);
  console.error('write them (RU, then ---, then EN — see 0.6.5.md), or pass --no-notes on purpose');
  process.exit(1);
}

/** Short-lived JWT — AMO rejects anything older than 5 minutes. */
function jwt() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({
    iss: env.FIREFOX_JWT_ISSUER,
    jti: String(Math.random()),
    iat: now,
    exp: now + 300,
  });
  const sig = createHmac('sha256', env.FIREFOX_JWT_SECRET)
    .update(`${head}.${body}`)
    .digest('base64url');
  return `${head}.${body}.${sig}`;
}

const API = 'https://addons.mozilla.org/api/v5';
const blob = (p) => new Blob([readFileSync(p)], { type: 'application/zip' });
const auth = () => ({ Authorization: `JWT ${jwt()}` });

const upload = new FormData();
upload.append('upload', blob(zipPath('firefox')), basename(zipPath('firefox')));
upload.append('channel', 'listed');
let res = await fetch(`${API}/addons/upload/`, { method: 'POST', headers: auth(), body: upload });
let data = await res.json();
if (!res.ok) throw new Error(`upload failed ${res.status}: ${JSON.stringify(data)}`);
const uuid = data.uuid;
console.log(`uploaded ${pkg.name} ${pkg.version} → ${uuid}`);

// AMO validates asynchronously; a version cannot be created until it is done.
for (let i = 0; ; i++) {
  if (i >= 60) throw new Error('validation did not finish in 3 minutes');
  await new Promise((r) => setTimeout(r, 3000));
  res = await fetch(`${API}/addons/upload/${uuid}/`, { headers: auth() });
  data = await res.json();
  if (!data.processed) continue;
  console.log(`validated: valid=${data.valid} errors=${data.validation?.errors ?? '?'}`);
  for (const m of (data.validation?.messages ?? []).filter((m) => m.type === 'error')) {
    console.error('  ERROR:', m.message);
  }
  if (!data.valid) process.exit(1);
  break;
}

const version = new FormData();
version.append('upload', uuid);
// The build is minified, so AMO requires the sources archive.
version.append('source', blob(zipPath('sources')), basename(zipPath('sources')));
if (existsSync(reviewerFile)) version.append('approval_notes', readFileSync(reviewerFile, 'utf8'));
// Release notes are NOT sent here. `release_notes[en-US]` as a multipart field
// is accepted without a murmur and stored nowhere: 0.7.0, 0.7.1 and 0.7.2 all
// went out with empty notes while this script logged a clean run (found 2026-08-14
// by asking the API what it actually kept). They go in the PATCH below instead.

res = await fetch(`${API}/addons/addon/${env.FIREFOX_EXTENSION_ID}/versions/`, {
  method: 'POST',
  headers: auth(),
  body: version,
});
data = await res.json();
// Re-running after a successful submit is a normal mistake (the Chrome half of
// `npm run submit` may need a retry while this half already landed). AMO tells
// us plainly; say so plainly instead of dumping a stack trace.
// Matched on the `version` field specifically — a 409 about something else
// must still surface as a failure, not be swallowed because the phrase happens
// to appear somewhere in the payload.
if (res.status === 409 && /already exists/i.test(String(data?.version ?? ''))) {
  console.log(`AMO: version ${pkg.version} is already there — nothing to do`);
  process.exit(0);
}
if (!res.ok) throw new Error(`version create failed ${res.status}: ${JSON.stringify(data)}`);
console.log(`AMO: version ${data.version} created (id ${data.id}, channel ${data.channel})`);

// The notes file is one document: Russian, a `---` line, then English.
if (existsSync(notesFile)) {
  const [ru, en] = readFileSync(notesFile, 'utf8').split(/^---$/m);
  const notes = { ru: ru.trim(), 'en-US': (en ?? ru).trim() };
  const patch = await fetch(
    `${API}/addons/addon/${env.FIREFOX_EXTENSION_ID}/versions/${data.id}/`,
    {
      method: 'PATCH',
      headers: { ...auth(), 'content-type': 'application/json' },
      body: JSON.stringify({ release_notes: notes }),
    },
  );
  const saved = await patch.json();
  if (!patch.ok) throw new Error(`release notes failed ${patch.status}: ${JSON.stringify(saved)}`);
  // Read what AMO kept, not what we sent: a green response is exactly what the
  // multipart field gave for three releases while storing nothing.
  const empty = Object.keys(notes).filter((l) => !saved.release_notes?.[l]?.trim());
  if (empty.length > 0) throw new Error(`AMO kept no release notes for: ${empty.join(', ')}`);
  console.log(`AMO: release notes stored (${Object.keys(saved.release_notes).join(', ')})`);
}
