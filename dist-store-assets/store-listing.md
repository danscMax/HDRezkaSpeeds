# HDRezka Speed Controller — Store listing copy

Drop-in copy for the Chrome Web Store / Firefox AMO listing forms. EN
sections come first (canonical), Russian translations follow.

---

## Item name

`HDRezka Speed Controller`

## Short description (max 132 characters)

Benefit-first: the first line is what a searcher sees before "read more".

> Speed up HDRezka movies and shows — speed buttons under the player,
> a slider, and hotkeys. Bilingual EN/RU, no ads, no tracking.

(128 characters.)

### Russian translation

> Ускоряйте фильмы и сериалы на HDRezka: кнопки скорости под плеером,
> ползунок и горячие клавиши. Без рекламы и трекинга.

(119 characters.)

---

## Detailed description (under 16,000 characters)

```
Watch movies and shows on HDRezka at your own pace. HDRezka Speed
Controller puts a row of speed buttons right under the player, so a
slow scene or a long episode plays faster — and a single click brings
it back to normal. A fine-grained slider and customizable keyboard
shortcuts give you exact control.

WHAT IT DOES

- 11 preset speed buttons (1.0x to 2.0x in 0.1 steps), positioned right
  below the player. Tuned for movie playback where small speed steps
  matter more than wide range.
- Slider for in-between values, with a coloured fill and a value
  tooltip that follows the thumb so you always see the exact rate.
- Single-click on a button = temporary speed for this video only.
  Double-click = save as the default for new videos. The saved speed
  is marked with a small accent dot in the corner of its button.
- Configurable hotkeys — assign multiple combinations per action so a
  remote and a keyboard can both trigger speed changes. Rebind them and
  set the step size in Settings → Keys.
- In-player gear menu with five tabs:
  - General: slider position (right / below / inside player), language
    switch (English / Russian), preset chips grouped by range
    (slower than 1×, 1×–2×, faster than 2×), behaviour toggles.
  - Keys: rebind speed-up / speed-down, add additional combos,
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
  on the fly. In fullscreen the panel steps out of the way — no extension
  UI on top of the picture; the keyboard shortcuts keep working.
- Dim the other monitors (optional, off by default). On a multi-monitor
  desk the bright windows beside the film keep pulling your eye. While
  the video plays fullscreen, the other displays are covered with a dark
  window — never the one showing the film. Leaving fullscreen removes
  them instantly. The darkness level is adjustable.
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

AFTER YOU INSTALL

A short walkthrough opens automatically in a new tab: what each control
does, how to set your keyboard shortcuts, and how to pin the icon to the
toolbar. It takes about a minute, and you can close it and start using
the extension right away.

COMPATIBILITY

Works on all known HDRezka mirrors out of the box, plus any mirror
domain you add yourself in the Mirrors tab (access is requested
per-domain via the standard browser permission prompt).
```

### Russian translation

```
Смотрите фильмы и сериалы на HDRezka в своём темпе. HDRezka Speed
Controller ставит ряд кнопок скорости прямо под плеером: затянутая
сцена или длинная серия идут быстрее, а один клик возвращает обычную
скорость. Точный ползунок и настраиваемые горячие клавиши дают полный
контроль.

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
- Настраиваемые горячие клавиши — можно назначить несколько комбинаций
  на одно действие (клавиатура + пульт ДУ), переназначить их и задать
  шаг в настройках, вкладка «Клавиши».
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
  «на лету». В полноэкранном режиме панель не мешает — интерфейс
  расширения не показывается поверх картинки, горячие клавиши работают.
- Затемнение других мониторов (по желанию, по умолчанию выключено). На
  многомониторном столе яркие окна сбоку тянут взгляд с фильма. Пока
  видео идёт в полноэкранном режиме, остальные экраны закрываются
  тёмным — монитор с фильмом не трогаем. Выход из полноэкранного
  режима сразу всё убирает. Яркость шторки настраивается ползунком.
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

СРАЗУ ПОСЛЕ УСТАНОВКИ

В новой вкладке автоматически откроётся короткая инструкция: что делает
каждый элемент, как назначить свои горячие клавиши и как закрепить
значок на панели. Занимает около минуты — можно закрыть и сразу
пользоваться.

СОВМЕСТИМОСТЬ

Работает на всех известных зеркалах HDRezka из коробки, а также на
любых зеркалах, которые вы добавите сами на вкладке «Зеркала»
(доступ запрашивается отдельно на каждый домен через стандартный
запрос разрешения браузера).
```

---

## Single-purpose statement (Chrome Web Store requires this)

> Control how HDRezka video plays: speed via in-player buttons, a slider
> and configurable keyboard shortcuts, plus an optional dark cover on the
> other monitors while the film runs fullscreen.

(The optional dimming is deliberately named here. It is part of the same
purpose — how the video is watched — and a reviewer who meets
`system.display` in the manifest without having read about it in the
listing has every reason to ask why a speed controller enumerates
displays.)

---

## Permissions justification (Chrome Web Store requires this)

| Permission | Why |
|---|---|
| `storage` | Persist user preferences (selected speed, hotkeys, language, slider position, preset list, user-added mirror list) so they survive page reloads and browser restarts. |
| `host_permissions` (HDRezka mirrors) | Inject the speed-control UI on the supported HDRezka mirrors. The extension never reads page content beyond the player container and never sends any data off-device. |
| `scripting` | Register the extension's own bundled content script on mirror domains the user adds in the Mirrors tab (`scripting.registerContentScripts`). No remote code, no arbitrary injection — the registered file is the same content script declared in the manifest. |
| `activeTab` | Read the active tab's URL when the popup is opened so the "Add current site as a mirror" button can offer the right domain, and reload that tab on the user's click after access is granted. |
| `system.display` | The optional "dim the other monitors" feature (off by default) needs the bounds of the attached displays to know which ones are NOT showing the fullscreen video, so it can cover those and leave the film's monitor alone. Only `chrome.system.display.getInfo()` is called, only while a video is playing fullscreen with the setting enabled. No display data is stored or sent anywhere. Chrome-only: the Firefox build ships without this permission and measures the layout by probing instead. |
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
| **Privacy policy URL** | `https://github.com/danscMax/HDRezkaSpeeds/blob/main/PRIVACY.md` (GitHub renders the Markdown directly — no Pages setup needed) |
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

Current version is **0.7.0** (`package.json` is the source of truth — the
zips are named from it, so read the version there instead of trusting this
table if the two ever disagree). Regenerate with `npm run zip` +
`npm run zip:firefox`.

| Store | File |
|---|---|
| Chrome Web Store | `.output/hdrezka-speeds-0.7.0-chrome.zip` |
| Firefox AMO (extension) | `.output/hdrezka-speeds-0.7.0-firefox.zip` |
| Firefox AMO (sources) | `.output/hdrezka-speeds-0.7.0-sources.zip` |
