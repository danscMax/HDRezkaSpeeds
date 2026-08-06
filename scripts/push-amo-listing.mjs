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
import { readFileSync } from 'node:fs';
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
const description = { 'en-US': fenced[0], ru: fenced[1] };

/**
 * Summaries live in blockquotes under "Short description" — EN first, then the
 * Russian translation. AMO caps the summary at 250 characters.
 */
const quotes = [...md.matchAll(/^> (.+(?:\n> .+)*)/gm)].map((m) =>
  m[1]
    .split('\n')
    .map((l) => l.replace(/^> ?/, ''))
    .join(' ')
    .trim(),
);
if (quotes.length < 2) {
  throw new Error(`expected 2 blockquoted summaries, found ${quotes.length}`);
}
const summary = { 'en-US': quotes[0], ru: quotes[1] };

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
