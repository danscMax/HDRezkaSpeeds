# Changelog

Notable changes per release. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning is [SemVer](https://semver.org/).

## [0.3.2] — 2026-05-07

### Fixed
- **HealthChecker watchdog now actually watches.** Earlier behaviour
  ran exactly one check 5 s after bootstrap; if the page was healthy
  at that moment, polling never started and any later degradation
  (HLS revert storm, episode-change layout flip, host JS swapping the
  player container) went undetected. The gear's red warning dot now
  lights up whenever the page actually breaks. (`src/health/checker.ts`)
- **Ratechange-revert timer escaped the per-attach cleanup registry.**
  The 50 ms counter-revert used a raw `setTimeout`; on episode change
  the disposed timer could still fire and write the previous video's
  rate onto the freshly-attached one. Now routed through
  `cleanup.setTimeout` so it dies with its attach. (`src/index.ts`)
- **Language toggle round-trip silently failed.** Switching `EN → RU
  → EN` left the UI stuck in Russian because the subscriber compared
  against the bootstrap-time language, never updating. Each fired
  comparison now updates the tracking variable. (`src/index.ts`)
- **Plyr localStorage patch installed before attachToVideo.** Earlier
  ordering put the patch a few orchestration steps later, so any
  Plyr write during initial player init poisoned its persisted blob
  and forced a flicker-fight on the next page load. Patch now runs
  immediately before the first attach. (HDRezka only)
- **HDRezka video-detection observer no longer scans on every
  mutation.** The previous broad `subtree:true` watch on
  `documentElement` ran `node.querySelectorAll('video')` per addedNodes
  Element — hundreds of times per minute on ad/comment-heavy pages.
  All mutations within an animation frame now coalesce into a single
  full-document scan; `seenVideos` keeps announcements idempotent.
  (HDRezka only)

## [0.3.1] — 2026-05-07

### Added
- **`role="status"` + `aria-live="polite"` on the speed value**, so
  screen readers announce the new playback rate when it changes via
  hotkey or a preset button click. The native `<input type=range>`
  only announces while focused; the live region covers the
  not-focused paths.

### Changed
- Worker (separate deploy): now enforces an `Origin` allowlist
  (`chrome-extension://*`, `moz-extension://*`). Submissions from
  open-web pages or non-browser tooling get a hard 403 before they
  consume any KV writes or Telegram quota. Real users from inside
  the extension are unaffected. See `cloudflare-worker/CHANGELOG`.

## [0.3.0] — 2026-05-07

### Added
- **`prefers-reduced-motion` support** — when the OS-level Reduce
  Motion preference is on, all our fades/slides/pulses become
  effectively instant (0.01ms). The active accent gradient and
  slider fill stay; only motion-sickness triggers go.
- **Confirmation dialog on Diagnostics → "Очистить кеш"** — was
  destructive and silent before. Now matches the existing
  full-reset gate.
- **`aria-live="polite"` on the diagnostic status block** so screen
  readers announce status updates when the watchdog or a manual
  recheck completes.
- **HDrezka-Improvement userscript detector** — emits a single
  `console.warn` when that userscript is detected on the same page,
  to help triage UI-overlap reports. Does NOT block our bootstrap.

### Changed
- Worker (separate deploy): IP addresses are now hashed (HMAC-SHA256)
  before being used as a rate-limit key in KV, and are no longer
  included in the Telegram message that arrives in the developer's
  inbox. See `cloudflare-worker/CHANGELOG` for details.

## [0.2.9] — 2026-05-07

### Fixed
- **AMO validator rejected the 0.2.8 manifest**:
  `data_collection_permissions.required` was set to
  `['technicalAndInteractionData']`, which is not a valid value in
  the AMO schema. Corrected to:
  - `required: ['none']` — the extension itself collects nothing
    automatically.
  - `optional: ['personalCommunications', 'technicalAndInteraction']`
    — these cover the Send-feedback form, which is fully opt-in
    (explicit Submit click + opt-in diagnostic checkbox).

  PRIVACY.md updated to match the new declaration.

## [0.2.8] — 2026-05-06

### Changed
- **Default hotkeys** moved off `Ctrl+C` / `Ctrl+V` (collided with the
  system copy/paste shortcut whenever the user had a text selection
  on the page) to `Alt+Shift+ArrowUp` / `Alt+Shift+ArrowDown`.
  Existing installations keep their saved hotkeys; new installs get
  the safer default.
- **Feedback form**: the "Attach diagnostic report" checkbox is now
  unchecked by default. The diagnostic blob carries device-fingerprint
  bits (settings, browser, viewport, language) — opt-in only.
- **Feedback payload**: stopped sending the full `userAgent` string.
  Browser-version detection moves into the opt-in diagnostic snapshot.

### Privacy
- AMO `data_collection_permissions` updated from `'none'` to
  `'technicalAndInteractionData'` to honestly disclose the optional
  Send-feedback flow. PRIVACY.md updated to match.

## [0.2.7] — 2026-05-06

### Fixed
- **Popup flicker on Diagnostics open**: the storage listener was
  rerendering the whole menu on every `vs-cache:*` write that
  HealthChecker emitted; now filtered to settings/speed keys only
  with a 50 ms coalesce window.

### Changed
- Settings menu width 340 → 380, popup width 380 → 420 so the
  four-tab strip (Общие/Клавиши/Диагностика/Поддержать) fits
  without label cropping.

## [0.2.6] — 2026-05-06

### Changed
- Popup auto-runs `vs:recheck` on Diagnostics tab open instead of
  reading cached `getLastReport()`. Popup and gear menu now always
  agree on the report at the moment the user looks at them.

## [0.2.5] — 2026-05-06

### Fixed
- Four-tab strip overflowed both popup (380px) and gear menu (340px)
  frames after the previous `flex: 0 0 auto` underline fix. Switched
  to `flex: 1 1 0` + `min-width: 0` + `overflow: hidden` so tabs
  share width evenly and crop on overflow without spilling past the
  flex-box.

## [0.2.4] — 2026-05-06

### Added
- **Live diagnostics in toolbar popup**: content script gains a
  `runtime.onMessage` listener for `vs:recheck` / `vs:get-status` /
  `vs:purge-cache`. Popup's "Recheck" / "Copy report" / "Purge
  cache" buttons now run for real over the message channel. Full
  reset stays gear-only.

### Fixed
- Active-tab underline was visibly shorter than the label because the
  flex container could shrink the button below its intrinsic content
  width while `white-space: nowrap` text spilled out. Pinned with
  `flex: 0 0 auto`.

## [0.2.3] — 2026-05-06

### Added
- Feedback button **in three places**: General-tab CTA (large, for
  ordinary users), Diagnostics-tab action (for power users already
  exploring tooling), Support-tab row (next to CloudTips).
- Feedback contact field is now **free-form text** ("How to reach
  you back") — accepts email, `@telegram`, Discord tag, anything.

### Fixed
- Diagnostics-tab action grid in the toolbar popup pointed at services
  that only exist in the content script. The buttons are now visually
  disabled in popup context with an explanatory banner above the menu;
  Send-feedback button stays enabled.

## [0.2.2] — 2026-05-06

### Changed
- Moved feedback button out of the Diagnostics tab into the Support
  tab — Diagnostics is power-user territory; ordinary users couldn't
  find feedback there.

### Fixed
- Popup width pinned with `min-width: 380px` on `<html>`, `<body>`
  AND `.vs-popup-shell` to defend against Firefox sampling body's
  intrinsic width on first paint and collapsing the popup to ~60px.

## [0.2.1] — 2026-05-06

### Added
- **Cloudflare Worker** (`cloudflare-worker/`) that accepts feedback
  POSTs from both extensions and forwards them to a Telegram bot.
  Per-IP rate limit 5/hour via KV.
- **In-extension feedback page** (`feedback.html`): rating, message,
  optional reply email, opt-in diagnostic snapshot.

### Fixed
- Feedback button tried `browser.tabs.create` (unavailable in content
  script) and silently fell back to `window.open('feedback.html')` —
  a relative URL the host page resolved against its own origin,
  landing the user at e.g. `rezka.ag/.../feedback.html` → 404. Now
  uses `runtime.getURL()` for the absolute extension URL.

## [0.2.0] — 2026-05-06

### Added
- Initial public release of HDRezka Speed Controller.
- **Eleven preset speed buttons** (1.0x – 2.0x in 0.1 steps), tuned
  for movie playback.
- **Slider** for in-between values, accent-coloured fill.
- **Hotkeys**: Ctrl+C +0.1 / Ctrl+V −0.1 by default (changed in
  0.2.8 — see above).
- **Gear menu** with Общие / Клавиши / Диагностика / Поддержать tabs.
- **Toolbar popup** mirrors the gear menu.
- **Auto-follows HDRezka theme** (light/dark) — multi-strategy
  detection: data-attributes, `b-body--*` classes, luminance walk,
  body text-color cross-check, deferred re-checks at 200/600/1500 ms
  + window.load to defeat HDRezka's JS-applied theme race.
- **Bilingual EN/RU** (auto-detected on first run; switchable in
  Settings).
- **Five-strategy DiscoveryEngine** (cache → exact → substring →
  ancestor-of-video → geometric heuristic) so the panel survives
  HDRezka layout changes.
- **Plyr playback-rate persistence patched** — episode changes can't
  override the user's chosen speed.
- **URL allow-list**: bootstrap only on `/films/*.html`,
  `/series/*.html`, `/cartoons/*.html`, `/animation/*.html`,
  `/show/*.html`, `/documentary/*.html` — listing pages
  (`/continue/`, `/favorites/`, profile, search) skipped.
- **Mirrors covered**: hdrezka.ag, rezka.ag, hdrezka.me, hdrezka.co,
  hdrezka.website, hdrezka.cm, hdrezka-home.tv, rezkify.com,
  rezkery.com, kinopub.me.
- **Welcome page** with onboarding + bilingual switch.
- **Privacy**: zero telemetry, zero analytics, zero remote calls
  (the optional 0.2.1 feedback flow is the only outbound path,
  triggered by an explicit user action).
