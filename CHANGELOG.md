# Changelog

Notable changes per release. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning is [SemVer](https://semver.org/).

## [0.3.11] — 2026-05-10

### Bug fixes

- **Settings menu no longer breaks on layout switch.** scrollTop is
  reset on every rerender; frozen flip-y is invalidated when
  sliderPosition changes.

### Layout

- **Auto-collapse "Right" to grid layout on narrow viewports** (< 1100px).
  Saved sliderPosition unchanged — when viewport widens back, panel
  returns to single-row "Right" layout.
- **Settings hint** explains the auto-collapse near the "Right" radio.

## [0.3.10] — 2026-05-10

### Layout

- **Auto-wrap on narrow viewports.** The panel + speed-buttons row now
  wrap to multiple lines when the user's chosen `sliderPosition`
  doesn't fit on one line, instead of overflowing into adjacent host
  page content.

## [0.3.9] — 2026-05-10

Continuation of the audit-driven cleanup that started in 0.3.8.

### Visual

- **Pluralized "issues found" headline** in EN diagnostic tab.

### Accessibility / UX

- **Settings menu announced as `dialog`** (was `menu`); + `aria-expanded`
  on the gear button.
- **Detached anchor for JSON-export.**
- **Production console hygiene** — info logs gated behind DEV.

### Bug fixes

- **KillSwitch propagation across instances** — popup-toggles take
  effect without page reload.
- **HealthChecker re-arms** when killSwitch.healthCheckEnabled
  transitions false → true post-bootstrap.
- **Cache `persist()` chain bounded** — fixes memory leak on tight
  `bumpSuccess` loops.
- **Firefox clipboard fallback** to `document.execCommand('copy')`.
- **Welcome page ResizeObserver disconnect** on language switch.
- **Defensive `try/catch` around `isHealthy()`** in diag-status.

### Performance

- `adjustMenuPosition` reads/writes batched (P1).
- `heuristicScan` for `playerContainer` is now an O(depth) ancestor
  walk instead of O(n_elements) × subtree query (P2).
- Settings handlers no longer double-rerender — 11 redundant
  `deps.rerender()` calls removed (P3).
- `translator.t()` uses `split().join()` for placeholders (P4).
- Single shared `formatSpeed()` in `ui/format.ts`.

## [0.3.8] — 2026-05-09

Outcome of a multi-agent audit pass against the entire codebase.
Six grouped commits cover security, data integrity, bootstrap
correctness, async race conditions, UI lifecycle, and high-impact
performance. Plus 15 new regression tests gated on the audit findings.

### Visual

- **Pinned-speed indicator redesign.** The 5×5 dot in the corner of the
  saved/default speed button is replaced by a SVG bookmark icon plus a
  soft accent halo glow. Colour follows `--vs-accent` (cyan on HDRezka).
- **Slider tooltip hidden at rest.** Appears only on hover/drag.

### Security

- **Hostname detection anchored** (sec C1). `host.includes('hdrezka')`
  / `host.includes('rezka.')` were replaced with anchored regexes that
  match canonical mirrors and a TLD-anchored wildcard, blocking
  attacker-controlled hosts like `hdrezka.evil.tld`.
- **Popup message sender validation** (sec C4).
- **Settings JSON-import allow-listed** (sec C5). Strict
  `KNOWN_SETTINGS_KEYS` filter + explicit `__proto__`/`constructor`
  strip + rejection on zero recognised keys.
- **Feature-detect probe wrapped in try/catch** (sec C19). Memoized.

### Data integrity

- **SettingsStore: write queue + rollback on persist failure** (sec C9).
- **GM-storage envelope JSON round-trip** (sec C10). Userscript-build
  adapter wraps every value in `{"_v":1,"d":<value>}` so primitives
  and strings round-trip losslessly.
- **Discovery validators return a fresh ok-result** (sec C11).
- **`Array.isArray` rejection** in TM migration boundary.

### Bootstrap correctness

- **TDZ guard on `killSwitch`** (sec C6).
- **`isDisposed` guard on popup-message install + SPA reattach** (sec C7/C8).
- **Language change triggers panel rerender.**

### Async race conditions

- **Click-counter race + unhandled rejection in speed controller** (C13/C14).
- **Hotkey capture race** (sec C15).
- **HealthChecker.runOnce is read-only** + **auto-trip latch resets**.

### UI lifecycle

- **Panel.dispose() removes orphan `#speed-notifications` / `#speed-popup`** (C16).
- **Notification stack restores host container's inline `position`** (C17).
- **Speed-popup `hideTimer` scoped per-popup via WeakMap** (C18).
- **Toast timers tracked + cleared on dispose.**
- **Slider `Number.isFinite` guards.**
- **Escape closes the gear settings menu** (a11y).

### Performance

- **New coalescing storage adapter** (perf O1) wraps the speed-store —
  held-hotkey at ~30/sec used to blow Chrome's quota.
- **HDRezka theme watcher: scoped click-listener** (perf O8) — was
  triggering a forced-style-recompute on every click sitewide.
- **HDRezka theme watcher: structured cold-load retry** (perf O9) —
  short-circuits as soon as `detectFromAttributes` finds the theme
  class on documentElement/body.
- **`speed_button_count` scoped to panel root** (perf O11).
- **`cleanup.setTimeout` self-removes from tracking Set** (perf O17).
- **Logger uses a circular buffer** (perf O20).
- **`lcaDistance` is O(d) via `Map`** (perf O7).
- **`detectFeatures()` is memoized.**

### Tests

- 15 new regression tests in `tests/unit/audit-2026-05-09.spec.ts`.

## [0.3.5] — 2026-05-08

Closes the three remaining items from the v0.3.4 audit pass plus a
maintainer-flagged design issue: the hardcoded version label in the
settings header forced a screenshot rebuild on every release.

### Added
- **Pinned-speed indicator on preset buttons.** When `rememberSpeed`
  is on, the button matching the saved/default speed gains a tiny
  accent dot in the top-right corner. Active state ("currently
  playing") and pinned state ("default for new videos") are now
  visually distinct — earlier they were inseparable.
- **Speed-preset chips grouped by range** in the Settings → "Кнопки
  скорости" section. Three subheaders ("Медленнее 1×", "1× – 2×",
  "Быстрее 2×"). Casual users were overwhelmed by the flat 14-18 pill
  wall; the wall is now scannable.
- **Panel auto-reparents into `fullscreenElement`** when entering
  fullscreen with `sliderPosition='right'` or `'bottom'`. Earlier the
  panel disappeared from view entirely because the OS-level
  fullscreen renders only the `fullscreenElement` subtree. On exit
  the panel is restored to its original parent.

### Changed
- **Default hotkeys reset to `Alt+Period` / `Alt+Comma`** (a.k.a.
  `Alt+.` / `Alt+,`). The old `Alt+Shift+ArrowUp/Down` collided with
  the Windows `Alt+Shift` Ru/En layout switcher and was a 3-key
  chord. New default is one modifier + the universal `>`/`<` speed
  convention from VLC / mpv. **Existing users keep their hotkeys** —
  the change applies only to fresh installs and Diagnostics → Full
  Reset.
- **Version label removed from the settings header.** Earlier it
  read `v0.3.X` and forced re-rendering the store-listing screenshots
  on every release. Version stays available via the diagnostic
  report (Diagnostics → "Скопировать отчёт"), where it actually
  matters for support.

## [0.3.4] — 2026-05-07

### Accessibility & Usability (UI/UX audit pass)

Five-expert audit (Visual / UX / A11y / Platform / Casual User) plus a
Devil's Advocate validator. 31 confirmed findings; this release closes
13 of them. Three more (in-fullscreen reparent, pinned-speed indicator,
preset-pool grouping) need more careful work and ship in 0.3.5.

### Added
- **Brand marker** (`vs-brand`) — a tiny accent-coloured chevron at
  the leading edge of the panel so users can tell at a glance that
  this is our extension rather than native host UI. Host-theme
  mirroring stays intact; this is only an identity cue. (`src/ui/panel.ts`)
- **Hotkey hint in onboarding** — the welcome page's first annotation
  now mentions the default `Alt+Shift+↑/↓` shortcut alongside the
  click + double-click instructions. Earlier users had to scroll to
  the configuration card to even know hotkeys existed.

### Changed
- **Slider value is now visible at rest** (`opacity: 0.92` instead of
  `0`). Earlier the floating tooltip only appeared on container hover
  / thumb drag — at rest you couldn't read the slider's current
  value. Reveals at full opacity + scale on interaction.
- **Active settings tab** now reads with bold + underline + colour
  instead of underline-and-colour-only. Strong non-colour cue for
  deuteranopia / monochrome.
- **Active "Speed buttons" subtitle (`vs-help-text`)** lifted from
  `opacity 0.7` to `0.85`, with comfortable line-height and bottom
  margin. The hint "Pick which speeds appear on the in-player panel"
  was technically there but visually swallowed.
- **Pill-button row now has a subtle backdrop** so the buttons read
  as a coherent group rather than as isolated capsules floating on
  the host's near-black background.
- **Light-theme contrast tokens** (`--vs-text-dim`, `--vs-text-secondary`)
  raised so caption-style text passes WCAG AA at small sizes. Dark
  theme also bumped a notch.
- **Section captions** (`КНОПКИ СКОРОСТИ`, `ПОЛОЖЕНИЕ ПОЛЗУНКА`) gain
  a `font-weight: 600` and higher opacity for readability at 10px.

### Fixed
- **Diagnostics gear icon now has `aria-label` and `aria-haspopup`**.
  Previously only `title=` was set, which is screen-reader-implementation
  dependent. Now the gear announces correctly.
- **"Закрепить навсегда" wording softened** to "сделать скоростью по
  умолчанию для новых видео". The old phrasing (in onboarding only)
  read like a permanent commitment users were afraid to make.

### Stale screenshots note
- The "v0.2.0" version label visible in the in-extension settings
  header on stored screenshots is NOT a code bug — `__VS_VERSION__`
  is wired correctly and now shows `0.3.4`. The store-listing
  screenshots were captured at v0.2.0 and need to be re-rendered
  before the next AMO/CWS submission.

## [0.3.3] — 2026-05-07

### Fixed
- **`Diagnostics → Очистить кеш` no longer reports success when the
  cache wipe fails.** The popup handler resolved with `ok: true` before
  `cache.purgeAll()` actually finished. `await` added so the popup gets
  the real result. (`src/index.ts`)
- **First-install settings are now pinned to disk.** Without the
  initial write, a future version that changes a default would silently
  flip users who never opened the gear menu. One storage write per
  fresh install, ever. (`src/storage/settings-store.ts`)
- **HC-Improvement userscript detector no longer false-positives on
  third-party class names.** `[class*="hc-"]` matched `bg-hc-banner`,
  `theme-hc-mode`, and any unrelated class containing the substring.
  Tightened to token-boundary selectors. (`src/utils/tm-coexist.ts`)
- **`unhandledrejection` listener now ties to `ctx.signal`.** Without
  it, dev HMR rebuilds accumulated one filter per reload. (`src/entrypoints/content.ts`)
- **`clamp()` rounding comment now matches the code.** Comment claimed
  1-decimal rounding while the implementation rounded to 0.01 — the
  0.01 behaviour is correct (configurable speed step), only the
  comment was misleading. (`src/speed/controller.ts`)

### Changed
- Worker (separate deploy): tighter input validation. Wrong-typed
  `version` / `url` / `userAgent` / `contact` / `email` / `diagnostics`
  values no longer surface as a generic 5xx — they get a clean
  `400 validation_failed` with the offending field name. New length
  caps (`version` ≤ 32, `url` ≤ 2048, `userAgent` ≤ 500) close a
  parse-allocation gap where a 60 KB-of-slack body could be parsed
  before being trimmed downstream.
- Worker: KV write failure after a successful Telegram delivery is
  now caught and logged instead of bubbling out as a 5xx. The user
  sees the success they earned; the missed rate-limit bump only buys
  one extra submission this hour.

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
