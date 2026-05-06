# HDRezka Speed Controller

**English** | [Русский](README.ru.md)

Browser extension (Chrome MV3 + Firefox MV3) that adds an always-visible
row of speed buttons, a fine-grained slider, and customizable keyboard
shortcuts to the HDRezka video player.

Bilingual interface (English / Russian). No ads, no telemetry.

## Features

- 11 preset speed buttons (1.0x – 2.0x in 0.1 steps), tuned for movie
  playback. Power users can add any custom value up to 10x.
- Slider for in-between values, with a coloured fill that tracks the
  current speed.
- Click = temporary speed for this video. Double-click = save as default.
- Configurable hotkeys (default `Ctrl+C` +0.1 / `Ctrl+V` −0.1). Supports
  multiple combos per action (keyboard + remote).
- In-player gear menu: General / Shortcuts / Diagnostics tabs.
- Toolbar popup mirrors the in-player menu.
- Auto-follows HDRezka's light / dark theme toggle.
- Supports all known mirrors: `hdrezka.ag`, `rezka.ag`, `hdrezka.me`,
  `hdrezka.co`, `hdrezka.website`, `hdrezka.cm`, `hdrezka-home.tv`,
  `rezkify.com`, `rezkery.com`, `kinopub.me`.

## Reliability

When HDRezka ships a layout change, the panel recovers automatically
through a five-strategy discovery chain (cached selector → exact match
→ substring match → walk up from the video element → geometric
heuristic). A built-in watchdog detects broken state, purges bad cache
entries, and re-attaches the panel. Plyr's playback rate persistence is
intercepted so the player can't race the extension's restore on every
episode change.

## Privacy

- All settings stored locally in `browser.storage.local`.
- Zero telemetry, zero analytics, zero remote calls.
- AMO `data_collection_permissions` disclosure: `none`.

See [PRIVACY.md](./PRIVACY.md).

## Install

- **Chrome Web Store** — *(submission pending)*
- **Firefox AMO** — *(submission pending)*

Manual install from a build (until the listings are approved):

```bash
git clone https://github.com/danscMax/HDRezkaSpeeds.git
cd HDRezkaSpeeds
npm install
npm run build           # → .output/chrome-mv3/
npm run build:firefox   # → .output/firefox-mv3/
```

Then in Chrome → `chrome://extensions` → enable Developer mode → "Load
unpacked" → point at `.output/chrome-mv3/`. Firefox → `about:debugging`
→ "This Firefox" → "Load Temporary Add-on…" → pick
`.output/firefox-mv3/manifest.json`.

## Develop

```bash
npm run dev             # Chrome MV3 with hot reload
npm run dev:firefox     # Firefox MV3 with hot reload
npm run typecheck       # tsc --noEmit
npm run test            # vitest unit tests
```

## Project layout

- `src/sites/` — HDRezka site bootstrap, Plyr localStorage patch, URL
  allow-list (`/films/*.html`, `/series/*.html`, etc.).
- `src/discovery/` — multi-strategy DOM resolver for the player and
  info containers.
- `src/ui/` — panel, slider, settings modal, theme detection.
- `src/storage/` — settings + speed stores backed by
  `browser.storage.local`.
- `src/health/` — watchdog + structured diagnostic report.
- `src/i18n/` — bilingual dictionary (EN/RU).
- `src/entrypoints/` — content script, background SW, popup, welcome page.
- `tests/store-screenshots/` — Playwright script that renders the four
  store-listing screenshots into `dist-store-assets/screenshots/`.

## Sister project

[VideoSpeeds](https://github.com/danscMax/VideoSpeeds) — the same
controller for **YouTube + RuTube**. Two extensions are kept separate
so each can declare narrow `host_permissions` in its manifest, which
makes Chrome Web Store and AMO review faster.

## License

GPL-3.0-or-later. See [LICENSE](./LICENSE).
