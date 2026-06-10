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
- Slider for in-between values, with a coloured fill and a value
  tooltip that follows the thumb so you always see the exact rate.
- Single-click on a button = temporary speed for this video only.
  Double-click = save as the default for new videos. The saved speed
  is marked with a small accent dot in the corner of its button.
- Configurable hotkeys (default Alt+Period / Alt+Comma — i.e. Alt+. /
  Alt+,) — assign multiple combinations per action so a remote and a
  keyboard can both trigger speed changes.
- In-player gear menu with five tabs:
  - General: slider position (right / below / inside player), language
    switch (English / Russian), preset chips grouped by range
    (slower than 1×, 1×–2×, faster than 2×), behaviour toggles.
  - Shortcuts: rebind speed-up / speed-down, add additional combos,
    reset to defaults.
  - Mirrors: HDRezka domains rotate constantly — add your own mirror
    domains and the extension works on them too. One click on the
    toolbar icon adds the site you're on; access is granted per-domain
    via the standard browser permission prompt.
  - Diagnostics: copy a structured report for bug submissions; clear
    cached selectors if a site update breaks the panel.
  - Support: feedback form (sends to the developer's Telegram via a
    Cloudflare Worker — no third-party analytics).
- Toolbar popup mirrors the in-player menu so you can adjust settings
  without opening a video.
- Automatically follows the HDRezka theme — the panel re-skins to match
  the site's light or dark mode, including when you toggle the theme
  on the fly. Survives fullscreen playback (panel re-parents into the
  fullscreen element so it stays visible).
- Accessibility: aria-labels on the gear button, aria-live status
  announcements for diagnostic state and speed changes,
  prefers-reduced-motion support.

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

COMPATIBILITY

Works on all known HDRezka mirrors out of the box, plus any mirror
domain you add yourself in the Mirrors tab (access is requested
per-domain via the standard browser permission prompt).
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
- Ползунок для промежуточных значений с цветной заливкой и
  всплывающей подписью значения над бегунком — точное значение видно
  всегда.
- Один клик по кнопке — временная скорость для этого видео. Двойной
  клик — сделать скоростью по умолчанию для новых видео. Сохранённая
  кнопка отмечена маленькой точкой в углу.
- Настраиваемые горячие клавиши (по умолчанию Alt+Period / Alt+Comma
  — то есть Alt+. / Alt+,) — можно назначить несколько комбинаций на
  одно действие (клавиатура + пульт ДУ).
- Меню настроек на шестерёнке с пятью вкладками:
  - «Общие»: положение ползунка, язык интерфейса, кнопки скорости
    сгруппированы по диапазонам (медленнее 1×, 1×–2×, быстрее 2×).
  - «Клавиши»: переназначение хоткеев, дополнительные комбинации,
    сброс к умолчанию.
  - «Зеркала»: домены HDRezka постоянно меняются — добавьте свои
    зеркала, и расширение заработает и на них. Один клик по иконке
    в тулбаре добавляет сайт, на котором вы находитесь; доступ
    выдаётся отдельно на каждый домен через стандартный запрос
    разрешения браузера.
  - «Диагностика»: скопировать отчёт для бага, очистить кеш
    селекторов.
  - «Поддержать»: форма обратной связи (отправляется в Telegram
    разработчика через Cloudflare Worker — без сторонней аналитики).
- Иконка расширения в тулбаре открывает то же меню без открытия
  видео.
- Автоматически следует за темой HDRezka — панель перекрашивается под
  светлый или тёмный режим сайта, в том числе при переключении темы
  «на лету». Сохраняется в полноэкранном режиме (панель переезжает в
  fullscreen-элемент при входе и обратно при выходе).
- Доступность: aria-labels на шестерёнке, объявление через aria-live
  при смене скорости и при обновлении статуса диагностики, поддержка
  prefers-reduced-motion.

ПРИВАТНОСТЬ

- Все настройки хранятся локально в browser.storage.local.
- Никакой телеметрии, никакой аналитики, никаких удалённых вызовов.
- Декларация AMO data_collection_permissions = "none".
- Исходники открыты на GitHub.

ЯЗЫКИ

Английский и русский. Язык интерфейса определяется автоматически
по языку браузера; переключается в меню в любой момент.

СОВМЕСТИМОСТЬ

Работает на всех известных зеркалах HDRezka из коробки, а также на
любых зеркалах, которые вы добавите сами на вкладке «Зеркала»
(доступ запрашивается отдельно на каждый домен через стандартный
запрос разрешения браузера).
```

---

## Single-purpose statement (Chrome Web Store requires this)

> Manage HDRezka video playback speed via in-player buttons, a slider,
> and configurable keyboard shortcuts.

---

## Permissions justification (Chrome Web Store requires this)

| Permission | Why |
|---|---|
| `storage` | Persist user preferences (selected speed, hotkeys, language, slider position, preset list, user-added mirror list) so they survive page reloads and browser restarts. |
| `host_permissions` (HDRezka mirrors) | Inject the speed-control UI on the supported HDRezka mirrors. The extension never reads page content beyond the player container and never sends any data off-device. |
| `scripting` | Register the extension's own bundled content script on mirror domains the user adds in the Mirrors tab (`scripting.registerContentScripts`). No remote code, no arbitrary injection — the registered file is the same content script declared in the manifest. |
| `activeTab` | Read the active tab's URL when the popup is opened so the "Add current site as a mirror" button can offer the right domain, and reload that tab on the user's click after access is granted. |
| `optional_host_permissions: *://*/*` | HDRezka mirror domains rotate constantly. New mirrors the user adds are requested individually at runtime via `permissions.request` behind an explicit user gesture (per-domain browser prompt). Nothing is granted silently at install. |

---

## Categories

- Chrome Web Store: **Productivity** (alternative: **Tools**)
- AMO: **Tabs** (alternative: **Other**)

## Tags / keywords (where the store accepts them)

`video speed`, `playback speed`, `keyboard shortcuts`

(Audit 2026-05-11: trimmed to focused tags after CWS rejected the
previous longer list for "keyword stuffing" — Yellow Argon
violation reference. Brand keywords like hdrezka/rezka belong in
the manifest's host_permissions, not the marketing description.)

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
| Chrome Web Store | `.output/hdrezka-speeds-0.3.5-chrome.zip` |
| Firefox AMO (extension) | `.output/hdrezka-speeds-0.3.5-firefox.zip` |
| Firefox AMO (sources) | `.output/hdrezka-speeds-0.3.5-sources.zip` |
