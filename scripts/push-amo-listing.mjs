/**
 * Push the store listing TEXT (summary + detailed description, EN and RU) from
 * dist-store-assets/store-listing.md to the add-on's AMO product page.
 *
 * Why this exists: the listing text is edited in a web form, so it silently
 * drifts from the repo. Measured 2026-08-06 — both add-ons were serving copy
 * from around 0.6.1 on both stores: no mention of dimming the other monitors
 * (the one thing no competitor has) and none of the "a walkthrough opens after
 * install" line. The card is what a person reads BEFORE installing, so a stale
 * card costs installs directly.
 *
 * The file is the source of truth; this only transcribes it. Run after editing
 * store-listing.md, then eyeball the public page.
 *
 *   node scripts/push-amo-listing.mjs [--dry-run]
 *
 * Chrome Web Store has no API for listing copy — that one stays manual.
 */

import { createHmac } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');

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

// Normalised to LF first: the file is checked out with CRLF on Windows, and
// every pattern below anchors on a bare newline — against CRLF they match
// nothing, which surfaces as "the file has no description blocks".
const CR = String.fromCharCode(13);
const md = readFileSync(join(root, 'dist-store-assets', 'store-listing.md'), 'utf8').split(CR).join('');

/** The two fenced blocks under "Detailed description" are EN then RU. */
const fenced = [...md.matchAll(/```\n([\s\S]*?)\n```/g)].map((m) => m[1]);
if (fenced.length < 2) {
  throw new Error(`expected 2 fenced description blocks, found ${fenced.length}`);
}
/**
 * The blocks are hard-wrapped at ~70 columns, which is comfortable to read in
 * an editor and wrong everywhere else: neither store re-flows the text, so
 * every wrap became a real line break and the live card read as a ragged
 * column (seen on the Chrome form, 2026-08-14). Rejoin each paragraph and each
 * list item into one line — blank lines, list markers and their indentation
 * are the only structure the stores render.
 *
 * `node scripts/push-amo-listing.mjs --selftest` checks the cases below.
 */
function unwrap(text) {
  const isItem = (line) => /^\s*[-*]\s/.test(line);
  return text
    .split('\n\n')
    .map((block) =>
      block
        .split('\n')
        .reduce((lines, line) => {
          if (lines.length === 0 || isItem(line)) lines.push(line.replace(/\s+$/, ''));
          else lines[lines.length - 1] += ` ${line.trim()}`;
          return lines;
        }, [])
        .join('\n'),
    )
    .join('\n\n');
}

if (process.argv.includes('--selftest')) {
  const eq = (got, want, name) => {
    if (got !== want) throw new Error(`${name}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
  };
  eq(unwrap('one two\nthree four'), 'one two three four', 'paragraph rejoined');
  eq(unwrap('a\n\nb'), 'a\n\nb', 'blank line kept');
  eq(unwrap('- one\n  wrapped\n- two'), '- one wrapped\n- two', 'list item rejoined');
  eq(unwrap('- top\n  - nested\n    wrapped'), '- top\n  - nested wrapped', 'nested indent kept');
  console.log('unwrap selftest: ok');
  process.exit(0);
}

const description = { 'en-US': unwrap(fenced[0]), ru: unwrap(fenced[1]) };

/**
 * The summary has exactly ONE source: `public/_locales`. That is the file
 * Chrome itself renders — it takes the name and the short description from the
 * package, never from the dashboard — so a second copy in store-listing.md is
 * a copy that cannot win. They had already drifted apart word for word by the
 * time anyone compared them (measured 2026-08-12). AMO caps the summary at 250
 * characters, Chrome at 132; the paste path enforces the stricter one.
 */
const localeSummary = (dir) =>
  JSON.parse(readFileSync(join(root, 'public', '_locales', dir, 'messages.json'), 'utf8'))
    .extDescription.message;
const summary = { 'en-US': localeSummary('en'), ru: localeSummary('ru') };

for (const [lang, text] of Object.entries(summary)) {
  if (text.length > 250) {
    throw new Error(`summary ${lang} is ${text.length} chars, AMO caps at 250`);
  }
}

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

console.log(`summary     en-US ${summary['en-US'].length} chars | ru ${summary.ru.length} chars`);
console.log(`description en-US ${description['en-US'].length} | ru ${description.ru.length}`);
if (dryRun) {
  console.log('dry run: nothing sent');
  process.exit(0);
}

/**
 * `--paste <dir>` writes the same four texts as plain files, one per Chrome Web
 * Store form field. Chrome has no listing API, so those fields are filled by
 * hand — and hand-cut files are exactly how the two stores drifted apart
 * before. Generating them from store-listing.md keeps one source for both.
 */
if (process.argv.includes('--paste')) {
  const outDir = process.argv[process.argv.indexOf('--paste') + 1];
  if (!outDir) {
    console.error('--paste needs a target directory');
    process.exit(1);
  }
  try {
    mkdirSync(outDir, { recursive: true });
  } catch (e) {
    // recursive:true is not silent when the path exists as a FILE — it throws
    // EEXIST. Every other failure here exits cleanly; this one should too.
    console.error(`cannot write to ${outDir}: ${e.code === 'EEXIST' ? 'it is a file' : e.message}`);
    process.exit(1);
  }
  // Named after the package so the two twins cannot collide in one folder,
  // and so nothing here needs per-repo configuration.
  const slug = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name;
  // Chrome's short description caps at 132 characters — AMO allows 250, so a
  // summary that passed the check above can still be rejected by the other
  // store. Catch it here rather than in the form, after the paste.
  for (const [lang, text] of Object.entries(summary)) {
    if (text.length > 132) {
      console.error(`summary ${lang} is ${text.length} chars; Chrome Web Store caps at 132`);
      process.exit(1);
    }
  }
  for (const [field, byLang] of Object.entries({ summary, description })) {
    for (const [lang, text] of Object.entries(byLang)) {
      const file = join(outDir, `${slug}-${field}-${lang === 'ru' ? 'RU' : 'EN'}.txt`);
      writeFileSync(file, `${text}\n`, 'utf8');
      console.log(`wrote ${file} (${text.length} chars)`);
    }
  }
  // No combined EN+RU file any more. The dashboard grew a "Current editing
  // language" selector once the package started shipping _locales (0.7.2): the
  // description is per-locale after all, so the two languages go into two
  // separate forms. The stacked version — English, a rule, then Russian — was
  // pasted into the English form on 2026-08-14 and is what the card showed.
  for (const [lang, text] of Object.entries(description)) {
    if (text.length > 16000) {
      console.error(`description ${lang} is ${text.length} chars; Chrome Web Store caps at 16000`);
      process.exit(1);
    }
  }
  process.exit(0);
}

/**
 * `--check` answers the question that let the drift happen in the first place:
 * is the live card still the text in this repo? Exits 1 when it is not, so it
 * can sit in the release ritual instead of being noticed months later.
 */
if (process.argv.includes('--check')) {
  /**
   * Comparable form. Two things make a byte comparison useless here, both
   * learned by watching it cry wolf on a listing that had just been pushed:
   * AMO stores the text as HTML (it turns "- " bullets into <ul><li>), and it
   * returns ONE locale per request — `?lang=all` answers with the default
   * locale only, so the Russian side looked empty and therefore "drifted".
   */
  const comparable = (s) =>
    String(s ?? '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/^[\s ]*[-•]\s+/gm, '')
      .replace(/\s+/g, ' ')
      .trim();

  let drifted = false;
  for (const lang of ['en-US', 'ru']) {
    const live = await fetch(
      `https://addons.mozilla.org/api/v5/addons/addon/${env.FIREFOX_EXTENSION_ID}/?lang=${lang}`,
      { headers: { Authorization: `JWT ${jwt()}` } },
    ).then((r) => r.json());
    for (const [field, want] of [
      ['summary', summary],
      ['description', description],
    ]) {
      const value = live[field];
      const got = comparable(typeof value === 'string' ? value : value?.[lang]);
      if (got !== comparable(want[lang])) {
        drifted = true;
        console.error(`DRIFT ${field} [${lang}]: live differs from store-listing.md`);
      }
    }
  }
  console.log(
    drifted ? 'listing is STALE — run without --check to push' : 'listing matches the repo',
  );
  process.exit(drifted ? 1 : 0);
}

const res = await fetch(
  `https://addons.mozilla.org/api/v5/addons/addon/${env.FIREFOX_EXTENSION_ID}/`,
  {
    method: 'PATCH',
    headers: { Authorization: `JWT ${jwt()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary, description }),
  },
);
const data = await res.json();
if (!res.ok) {
  throw new Error(`listing update failed ${res.status}: ${JSON.stringify(data)}`);
}
console.log(`AMO listing updated: ${data.slug} (last_updated ${data.last_updated})`);
