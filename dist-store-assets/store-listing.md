# HDRezka Speed Controller — Store listing copy

Drop-in copy for the Chrome Web Store / Firefox AMO listing forms. EN
sections come first (canonical), Russian translations follow.

---

## Item name and short description — NOT here

Both live in `public/_locales/{en,ru}/messages.json` (`extName`,
`extDescription`), because Chrome renders them straight from the package and
ignores anything typed into the dashboard. This file used to keep a second
copy; by the time the two were compared they disagreed on every word, and the
copy nobody could see was the one being pushed to AMO. `push-amo-listing.mjs`
now reads `_locales` for the summary, so editing it there updates both stores.
Chrome caps it at 132 characters — half of AMO's limit, and the binding one.

---

## Detailed description (under 16,000 characters)

```
Watch films and shows on HDRezka at your own pace. This extension puts a
row of speed buttons right under the player: a drawn-out scene or a long
episode moves faster, and one click brings the normal speed back.

What it does

- Speed buttons under the player. Out of the box they go from 1x to 2x
  in steps of 0.1 — for a film, a fine step is worth more than a wide
  range. The set is yours to change, anywhere from 0.5x to 4x.
- A slider for anything in between, with the exact rate shown above the
  handle as you drag it.
- One click sets the speed for the film you are watching. A double click
  makes it the speed everything starts at — the saved button is marked
  with a dot in the corner.
- Keyboard shortcuts, several combinations per action if you like, so a
  remote and a keyboard can both do the job. Rebind them and set the
  step in the settings.
- A gear menu inside the player: where the slider sits, interface
  language, which buttons to show, how the panel behaves. There is also
  a feedback form that reaches the developer directly, and a report you
  can copy in one click if a site update ever knocks the panel out.
- Mirrors. The mirrors that exist today work out of the box, and since
  HDRezka's domains change constantly you can add new ones yourself:
  open the mirror, click the extension icon, and confirm access for that
  one site. The list is kept locally and survives updates.
- The panel follows the site's own light or dark theme, including when
  you switch it while watching.
- Dimming the other monitors (optional, off by default). On a desk with
  several screens the bright windows next to the film keep pulling your
  eye. While the film plays fullscreen, the other monitors are covered
  with dark — never the one you are watching — and everything clears the
  moment you leave fullscreen. How dark it gets is up to you.
- In fullscreen the panel keeps out of the picture, while the speed you
  chose is confirmed by a large label. The shortcuts keep working.

When the site changes

HDRezka redesigns without warning, and a panel pinned to one spot
disappears the moment it does. This one looks for the player five
different ways in turn and re-attaches itself wherever it turns up. It
also holds your speed across episodes, which the player itself likes to
reset.

Privacy

Your settings stay in your own browser. The extension collects no
statistics, tracks nothing you watch and sends nothing anywhere. The
source code is open, so any of this can be checked.

Languages

English and Russian. The interface follows your browser on first run and
can be switched from the menu at any time.

Right after you install

A short guide opens in a new tab: what each control does, how to set
your shortcuts, how to pin the icon to the toolbar. A minute to read,
then close it and get on with it.
```

### Russian translation

```
Смотрите фильмы и сериалы на HDRezka в своём темпе. Расширение ставит ряд
кнопок скорости прямо под плеером: затянутая сцена или длинная серия идут
быстрее, а один клик возвращает обычную скорость.

Что умеет

- Кнопки скорости под плеером. Из коробки — от 1× до 2× с шагом 0.1: для
  фильма мелкий шаг важнее широкого диапазона. Набор кнопок вы меняете
  сами, от 0.5× до 4×.
- Ползунок для промежуточных значений: точное число видно над бегунком,
  пока вы его тянете.
- Один клик задаёт скорость для этого фильма. Двойной — делает её той, с
  которой всё начинается дальше; сохранённая кнопка помечена точкой в
  углу.
- Горячие клавиши. На одно действие можно назначить несколько сочетаний
  — скажем, чтобы работали и клавиатура, и пульт. Сочетания и шаг
  меняются в настройках.
- Меню на шестерёнке прямо в плеере: где показывать ползунок, язык
  интерфейса, набор кнопок, поведение панели. Там же форма обратной
  связи — письмо приходит разработчику, — и отчёт, который копируется
  одной кнопкой, если после обновления сайта панель собьётся.
- Зеркала. Все нынешние работают сразу, а поскольку домены HDRezka
  постоянно меняются, новые вы добавляете сами: откройте зеркало,
  нажмите на значок расширения и подтвердите доступ к этому сайту.
  Список хранится у вас и переживает обновления.
- Панель подхватывает тему сайта — светлую или тёмную, в том числе если
  переключить её прямо во время просмотра.
- Затемнение соседних мониторов (по желанию, по умолчанию выключено). За
  столом с несколькими экранами яркие окна сбоку тянут взгляд с фильма.
  Пока фильм идёт в полноэкранном режиме, остальные мониторы закрываются
  тёмным — тот, на котором вы смотрите, не трогается, — а на выходе всё
  сразу убирается. Насколько темно, решаете вы.
- В полноэкранном режиме панель не загораживает картинку, а выбранная
  скорость подтверждается крупной плашкой. Горячие клавиши продолжают
  работать.

Если сайт изменится

HDRezka меняет вёрстку без предупреждения, и панель, привязанная к одному
месту, после этого просто исчезает. Эта ищет плеер пятью способами по
очереди и прикрепляется туда, где он оказался. Она же удерживает вашу
скорость при переходе между сериями — сам плеер норовит её сбросить.

Приватность

Настройки хранятся в вашем браузере. Расширение не собирает статистику,
не следит за тем, что вы смотрите, и никуда ничего не отправляет.
Исходный код открыт — всё это можно проверить.

Языки

Русский и английский. При первом запуске язык берётся из браузера, потом
переключается в меню.

Сразу после установки

В новой вкладке откроется короткая инструкция: что делает каждый
элемент, как назначить горячие клавиши и как закрепить значок на панели.
Минута чтения — и можно закрывать.
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

Four 1280x800 JPEGs in `dist-store-assets/screenshots/`, designed for
the Chrome Web Store size + format constraints (CWS rejects anything
that isn't exactly 1280x800 / 640x400 and won't accept PNGs with an
alpha channel). Recommended upload order:

1. `01-hdrezka-panel.jpg` — full-page HDRezka mock, shows where the
   panel lives in context (header + player + panel below).
2. `02-hdrezka-settings.jpg` — same page with the settings modal open,
   explaining presets / slider position / behaviour toggles in one
   image.
3. `03-hdrezka-dimming.jpg` — the settings body scrolled to "Dim other
   monitors in fullscreen", its level field and the sentence explaining
   it. Added 2026-08-12: this is the only feature no competing
   extension has, it lives below the fold, and the deck had been
   showing everything except the reason to choose this one.
4. `04-welcome-page.jpg` — welcome onboarding (light theme; adds
   visual variety to the otherwise dark deck).

Re-generate any time with: `node tests/store-screenshots/render.mjs`
(needs an extension build under `.output/chrome-mv3/`; run
`npm run build` first).

---

## Files to upload

Current version is **0.7.1** (`package.json` is the source of truth — the
zips are named from it, so read the version there instead of trusting this
table if the two ever disagree). Regenerate with `npm run zip` +
`npm run zip:firefox`.

| Store | File |
|---|---|
| Chrome Web Store | `.output/hdrezka-speeds-0.7.1-chrome.zip` |
| Firefox AMO (extension) | `.output/hdrezka-speeds-0.7.1-firefox.zip` |
| Firefox AMO (sources) | `.output/hdrezka-speeds-0.7.1-sources.zip` |
