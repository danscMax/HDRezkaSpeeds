# Contributing to HDRezka Speed Controller

Thanks for your interest! This is a small but real codebase — pull
requests, bug reports, and translation fixes are all welcome.

If you only want to report a bug or suggest a feature, the in-extension
**Send feedback** form (gear menu → **Поддержать**, or the popup's
**Support** tab) is the lowest-friction path. It goes straight to the
maintainer's Telegram. No GitHub account needed.

If you want to send code, read on.

---

## Dev setup

Prerequisites: Node 22+, npm 10+.

```bash
git clone https://github.com/danscMax/HDRezkaSpeeds.git
cd HDRezkaSpeeds
npm install        # also runs `wxt prepare` for type generation
npm run dev        # Chrome MV3, hot reload
npm run dev:firefox  # Firefox MV3, hot reload
```

WXT will print a `chrome-extension://...` URL plus instructions to load
the unpacked extension once. After that, edits to `src/**` rebuild and
reload automatically.

---

## Sanity checks before pushing

```bash
npm run typecheck   # strict tsc --noEmit
npm run zip         # Chrome MV3 zip in .output/
npm run zip:firefox # Firefox MV3 zip in .output/
```

CI runs these on every PR plus a 500 KB content-script bundle budget
and `web-ext lint` against the Firefox build. Run them locally and
you'll catch ~all of what CI would flag.

The `cloudflare-worker/` subdirectory is its own micro-project.
If your PR touches it:

```bash
cd cloudflare-worker
npm ci
npx tsc --noEmit
```

The worker is **not** auto-deployed from CI — `wrangler deploy` stays
manual. Any Worker change is deploy-after-merge by the maintainer.

---

## Branching

- Cut feature branches off `main`, use `feature/<short-slug>` or
  `fix/<short-slug>`.
- Squash-merge by default. The PR title becomes the squash commit
  subject — keep it scannable (e.g. `theme: detect dark mode after
  body class swap`).
- Keep one logical change per PR. CI is fast; small PRs review faster.

---

## Code style

- TypeScript strict mode. No `any` without an inline justification
  comment.
- Comments in English (this is a hard rule even for RU-only code paths
  — keeps the codebase legible to outside contributors).
- No console.log left in the shipped bundle. Use the project `logger`
  from `src/utils/logger.ts`.
- Don't disable rules to make a build pass. If something looks
  red-flag, ask in the PR.

---

## Bilingual strings

User-facing text lives in `src/i18n/dict.ts`. Both `en` and `ru`
branches must stay in sync — TypeScript will yell at you if a key
exists in one and not the other. New strings: add the EN value first,
then the RU translation; keep them roughly the same length so layouts
don't break.

---

## Privacy & data handling

The extension's privacy posture is documented in [PRIVACY.md](./PRIVACY.md)
and reflected in the manifest's `data_collection_permissions`. Any
change that adds outbound network traffic, persisted user data, or new
permissions is a **major** change — open an issue first to discuss
before submitting the PR.

The Cloudflare Worker (separate deploy) hashes incoming IPs before
using them as rate-limit keys and never includes them in the forwarded
Telegram message.

---

## Reporting bugs / requesting features

GitHub issues use templates — pick **Bug report** or **Feature
request** at <https://github.com/danscMax/HDRezkaSpeeds/issues/new/choose>.

For most users the in-extension **Send feedback** form is faster and
doesn't require a GitHub account.
