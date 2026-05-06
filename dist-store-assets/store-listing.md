# HDRezka Speed Controller — Store listing copy

Drop-in copy for the Chrome Web Store / Firefox AMO listing forms. EN
sections come first (canonical), Russian translations follow.

---

## Item name

`HDRezka Speed Controller`

## Short description (max 132 characters)

> Speed buttons, slider and customizable hotkeys for HDRezka videos.
> Bilingual EN/RU. No ads, no tracking.

(127 characters.)

### Russian translation

> Кнопки скорости, ползунок и горячие клавиши для видео HDRezka.
> Двуязычный EN/RU. Без рекламы и трекинга.

---

## Detailed description (under 16,000 characters)

```
HDRezka Speed Controller adds an always-visible row of speed buttons, a
fine-grained slider, and customizable keyboard shortcuts to the HDRezka
video player.

WHAT IT DOES

- 11 preset speed buttons (1.0x to 2.0x in 0.1 steps), positioned right
  below the player. Tuned for movie playback where small speed steps
  matter more than wide range.
- Slider for in-between values, with a coloured fill that tracks the
  current speed.
- Single-click on a button = temporary speed for this video only.
  Double-click = save as the default for HDRezka.
- Configurable hotkeys (default Ctrl+C +0.1 / Ctrl+V -0.1) — assign
  multiple combinations per action so a remote and a keyboard can both
  trigger speed changes.
- In-player gear menu with three tabs:
  - General: slider position (right / below / inside player), language
    switch (English / Russian), behaviour toggles, advanced auto-recover
    and self-diagnostics switches.
  - Shortcuts: rebind speed-up / speed-down, add additional combos,
    reset to defaults.
  - Diagnostics: copy a structured report for bug submissions; clear
    cached selectors if a site update breaks the panel.
- Toolbar popup mirrors the in-player menu so you can adjust settings
  without opening a video.
- Automatically follows the HDRezka theme — the panel re-skins to match
  the site's light or dark mode, including when you toggle the theme
  on the fly.

WHY IT'S RELIABLE

When HDRezka ships a layout change, the panel recovers automatically
through a five-strategy discovery chain (cached selector → exact match
→ substring match → walk up from the video element → geometric
heuristic). A built-in watchdog detects broken state, purges bad cache
entries, and re-attaches the panel. Plyr's playback rate persistence
is intercepted so the player can't race our restore on every episode
change.

PRIVACY

- All settings stored locally in browser.storage.local.
- Zero telemetry, zero analytics, zero remote calls.
- The AMO data_collection_permissions disclosure is set to "none".
- Source available on GitHub for review.

LANGUAGES

English and Russian. UI language is auto-detected from your browser on
first run; switch any time from the gear menu.

SUPPORTED MIRRORS

hdrezka.ag, rezka.ag, hdrezka.me, hdrezka.co, hdrezka.website,
hdrezka.cm, hdrezka-home.tv, rezkify.com, rezkery.com, kinopub.me

LICENSE

GPL-3.0-or-later (GNU General Public License version 3 or later).
```

### Russian translation

```
HDRezka Speed Controller добавляет всегда видимую панель кнопок
скорости, точный ползунок и настраиваемые горячие клавиши в плеер
HDRezka.

ЧТО УМЕЕТ

- 11 кнопок скорости (1.0x – 2.0x с шагом 0.1) под плеером. Подобраны
  для просмотра фильмов, где важен мелкий шаг изменения скорости, а
  не широкий диапазон.
- Ползунок для промежуточных значений с цветной заливкой, отражающей
  текущую скорость.
- Один клик по кнопке — временная скорость для этого видео. Двойной
  клик — сохранить как основную для HDRezka.
- Настраиваемые горячие клавиши (по умолчанию Ctrl+C +0.1 / Ctrl+V
  -0.1) — можно назначить несколько комбинаций на одно действие
  (клавиатура + пульт ДУ).
- Меню настроек на шестерёнке с тремя вкладками: «Общие», «Клавиши»,
  «Диагностика».
- Иконка расширения в тулбаре открывает то же меню без открытия
  видео.
- Автоматически следует за темой HDRezka — панель перекрашивается под
  светлый или тёмный режим сайта, в том числе при переключении темы
  «на лету».

ПРИВАТНОСТЬ

- Все настройки хранятся локально в browser.storage.local.
- Никакой телеметрии, никакой аналитики, никаких удалённых вызовов.
- Декларация AMO data_collection_permissions = "none".
- Исходники открыты на GitHub.

ЯЗЫКИ

Английский и русский. Язык интерфейса определяется автоматически
по языку браузера; переключается в меню в любой момент.

ПОДДЕРЖИВАЕМЫЕ ЗЕРКАЛА

hdrezka.ag, rezka.ag, hdrezka.me, hdrezka.co, hdrezka.website,
hdrezka.cm, hdrezka-home.tv, rezkify.com, rezkery.com, kinopub.me

ЛИЦЕНЗИЯ

GPL-3.0-or-later.
```

---

## Single-purpose statement (Chrome Web Store requires this)

> Manage HDRezka video playback speed via in-player buttons, a slider,
> and configurable keyboard shortcuts.

---

## Permissions justification (Chrome Web Store requires this)

| Permission | Why |
|---|---|
| `storage` | Persist user preferences (selected speed, hotkeys, language, slider position, preset list) so they survive page reloads and browser restarts. |
| `host_permissions` (HDRezka mirrors) | Inject the speed-control UI on the supported HDRezka mirrors. The extension never reads page content beyond the player container and never sends any data off-device. |

---

## Categories

- Chrome Web Store: **Productivity** (alternative: **Tools**)
- AMO: **Tabs** (alternative: **Other**)

## Tags / keywords (where the store accepts them)

`hdrezka`, `rezka`, `video speed`, `playback speed`, `hotkeys`,
`keyboard shortcuts`, `video player`, `slider`, `plyr`

---

## Listing fields (paste verbatim into the form)

| Field | Value |
|---|---|
| **Item name** | `HDRezka Speed Controller` |
| **Summary** | see *Short description* above |
| **Category** | `Productivity` |
| **Language** | `English` (primary), add `Russian` translation |
| **Homepage URL** | `https://github.com/danscMax/HDRezkaSpeeds` |
| **Support URL** | `https://github.com/danscMax/HDRezkaSpeeds/issues` |
| **Privacy policy URL** | host `PRIVACY.md` on GitHub Pages |
| **Mature content** | OFF |
| **Data collection** | mark every category as *Not collected* |

---

## Screenshots to upload

Three 1280x800 JPEGs in `dist-store-assets/screenshots/`, designed for
the Chrome Web Store size + format constraints (CWS rejects anything
that isn't exactly 1280x800 / 640x400 and won't accept PNGs with an
alpha channel). Recommended upload order:

1. `01-hdrezka-panel.jpg` — full-page HDRezka mock, shows where the
   panel lives in context (header + player + panel below).
2. `02-hdrezka-settings.jpg` — same page with the settings modal open,
   explaining presets / slider position / behaviour toggles in one
   image.
3. `03-welcome-page.jpg` — welcome onboarding (light theme; adds
   visual variety to the otherwise dark deck).

Re-generate any time with: `node tests/store-screenshots/render.mjs`
(needs an extension build under `.output/chrome-mv3/`; run
`npm run build` first).

---

## Files to upload

| Store | File |
|---|---|
| Chrome Web Store | `.output/hdrezka-speeds-0.2.0-chrome.zip` |
| Firefox AMO (extension) | `.output/hdrezka-speeds-0.2.0-firefox.zip` |
| Firefox AMO (sources) | `.output/hdrezka-speeds-0.2.0-sources.zip` |
