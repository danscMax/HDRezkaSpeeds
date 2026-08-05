# Known constraints and caveats

Operational summary for contributors. Mirrors the sibling project's
`VideoSpeeds/docs/CAVEATS.md` where the constraint is shared.

## Build & dev workflow

### Project path

The repo lives at `E:\Scripts\Browser extensions\HDRezkaSpeeds\`. It used to sit
under a Cyrillic path, which several tools choked on; the folder was renamed and
the ASCII path is the only supported one now. Two habits survive from that era:

- **Chrome `--load-extension=`** is fussy about exotic characters and about
  spaces on some Windows setups. `tests/smoke/extension-loads.spec.ts` copies
  the build into a tmpdir before launching Chromium; do the same if you load
  `.output/chrome-mv3` by hand.

- **PowerShell** for npm/wxt commands needs the explicit UTF-8 prefix
  (`[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`) so Russian output
  is not mangled, and `-LiteralPath '...'` with single quotes around the path.

## Browser facts we MEASURED (do not re-derive them)

Each of these cost a debugging session. None are in any spec; they were measured
on Firefox Developer Edition 154 / Windows 11 with a 3-monitor mixed-DPI desktop,
and they are why several pieces of code look odd.

- **Firefox falsifies `screen.availWidth/availHeight` in content scripts.** Its
  fingerprinting protection rewrites them and says so in the page console.
  Anything needing to know which monitor something is on must NOT read them from
  page context — FEAT-020 derives the player's monitor from the window rect
  returned by `browser.windows.get()` instead.
- **Firefox MV3 grants NO host permission when one is added by an UPDATE.**
  Neither shown nor granted (Mozilla bug 1893232), and the user can revoke access
  at any time. The content script then never runs: no panel, no error, nothing in
  the console. `src/health/permission-badge.ts` exists to make that visible.
- **`focused: false` is ignored by `windows.create` since Firefox 86.** Every
  window an extension opens takes focus. Any design assuming an unobtrusive
  background window is wrong on Firefox.
- **`state: 'fullscreen'` re-picks which display a window belongs to.** Using it
  to PLACE a window threw the dim overlay onto the monitor playing the video.
  Place by explicit rect first, promote to fullscreen only afterwards.
- **Each screen's CSS rect is in its OWN monitor's scale.** On a mixed-DPI
  desktop the rects overlap — measured: 384px between a 150% primary and a 176%
  neighbour — so "which screen is this window on" cannot be settled by a naive
  largest-overlap test alone.
- **Firefox cannot be driven by Playwright for extension work, but it CAN be
  measured:** `web-ext run` installs the extension for real, and a throwaway MV2
  extension can POST its findings to a local HTTP server. The working harness is
  in `.claude/skills/twin-extensions/probe-firefox-coords/`.

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

Legitimate divergence inside shared files (mirrors wiring, selectors,
RuTube-only settings, per-product i18n/styles content) is acknowledged
in `scripts/drift-baseline.json` via a symmetric pair-hash: the file
stays silent until either side changes again, then reappears as
unexpected drift. There is no permanent allow-list — every divergent
file gets re-flagged on change so a real fix is never silently skipped.
After reviewing/porting, re-acknowledge with
`npm run drift -- --accept`; it writes the baseline into BOTH checkouts
(commit it in both). Only `scripts/check-drift.mjs` itself still needs
a manual copy to the twin when the script changes.
