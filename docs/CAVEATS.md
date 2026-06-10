# Known constraints and caveats

Operational summary for contributors. Mirrors the sibling project's
`VideoSpeeds/docs/CAVEATS.md` where the constraint is shared.

## Build & dev workflow

### Cyrillic in the project path

The repo lives at `E:\Scripts\Расширения\HDRezkaSpeeds\`. npm/Node/WXT/Vite
handle this fine, but a few tools choke on the non-ASCII path:

- **Chrome `--load-extension=`** rejects Cyrillic in the path on Windows.
  The Playwright smoke test (`tests/smoke/extension-loads.spec.ts`) sidesteps
  this by copying the build into an ASCII tmpdir before launching Chromium.
  If you ever load the unpacked build manually with `--load-extension=`,
  copy `.output/chrome-mv3` to e.g. `C:\Temp\hdrezka-build` first.

- **PowerShell** for npm/wxt commands needs the explicit UTF-8 prefix
  (`[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`) and
  `Set-Location -LiteralPath '...'` with single quotes around the path.

### Build cadence

WXT does not auto-watch outside `wxt dev`. After any source change:
`npx wxt build` (Chrome) or `npm run build:firefox` (Firefox MV3),
then reload the extension in `chrome://extensions/` / `about:debugging`.

## Site specifics (HDRezka)

- The player is **Plyr over HLS**; it persists its own `speed` into
  localStorage and re-applies it aggressively. `patchPlyrLocalStorage()`
  must run **before** `attachToVideo` (see src/index.ts step 9.5) or the
  restore fights Plyr on every episode change.
- HDRezka is a **multi-page site** (no SPA router); navigation handling is
  bf-cache (`pageshow`) + `popstate` + the new-`<video>` MutationObserver in
  `src/sites/hdrezka.ts`. Don't port the VideoSpeeds page-world bridge here —
  it solves a YouTube/RuTube-only problem.
- Mirrors: the static list lives in `src/sites/mirror-hosts.ts` and must be
  kept in sync with the regexes in `src/sites/detect.ts`. User-added mirrors
  go through dynamic content-script registration in the background SW.

## Twin-project sync

`HDRezkaSpeeds` and `VideoSpeeds` share most of `src/` by copy-paste.
Run `npm run drift` to compare the shared core against the sibling
checkout and port fixes both ways before a release.

Legitimate site-specific divergence inside shared files (mirrors wiring,
selectors, RuTube-only settings) is acknowledged in
`scripts/drift-baseline.json` via a symmetric pair-hash: the file stays
silent until either side changes again, then reappears as unexpected
drift. After reviewing/porting, re-acknowledge with
`npm run drift -- --accept` and copy both `scripts/check-drift.mjs` and
`scripts/drift-baseline.json` to the twin so the two checkouts agree.
