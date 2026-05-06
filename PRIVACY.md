# Privacy Policy — HDRezka Speed Controller

[English](#english) | [Русский](#russian)

Last updated: 2026-05-06

---

<a id="english"></a>

## English

### What we collect

**Nothing.** No analytics, no telemetry, no remote requests. The
extension never reads, sends, or stores any personally identifiable
information.

### What we transmit

**Nothing.** The extension makes zero outbound network requests. It
works entirely within your browser tab.

### Where settings live

All extension settings (selected speed, hotkey bindings, slider
position, language, "remember speed" toggle, custom preset list) are
persisted in [`browser.storage.local`][storage], the per-extension
local storage provided by the browser. Data never leaves your device.

### Diagnostics report

The Diagnostics tab in the gear menu has a "Copy report" button that
puts a JSON snapshot on your clipboard. The snapshot includes the
domain (e.g. `rezka.ag`), the page path **without query string or
URL fragment**, your user agent, viewport size, the panel's own state,
and recent ratechange events. The report is generated only when YOU
click the button and is placed only on YOUR clipboard — the extension
itself never sends it anywhere. Paste it into a GitHub issue if you
want to send it to the developer.

### Permissions explained

| Permission | Why |
|---|---|
| `storage` | Persist your settings between sessions. |
| `host_permissions` (HDRezka mirrors) | Inject the speed-control UI into the HDRezka video player. The extension does not run on any other site. |

The Firefox manifest declares
`browser_specific_settings.gecko.data_collection_permissions: { required: ['none'] }`
so the AMO listing makes the zero-collection promise machine-readable.

### Source code

The extension is open source under the GNU General Public License v3.0
or later (GPL-3.0-or-later). Audit the implementation at
[github.com/danscMax/HDRezkaSpeeds](https://github.com/danscMax/HDRezkaSpeeds).

### Contact

File issues or questions on the [GitHub repository][issues].

[storage]: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/local
[issues]: https://github.com/danscMax/HDRezkaSpeeds/issues

---

<a id="russian"></a>

## Русский

### Что мы собираем

**Ничего.** Никакой аналитики, никакой телеметрии, никаких удалённых
запросов. Расширение никогда не читает, не отправляет и не хранит
никаких персональных данных.

### Что мы передаём

**Ничего.** Расширение не делает ни одного исходящего сетевого
запроса. Оно работает полностью внутри вашей вкладки браузера.

### Где хранятся настройки

Все настройки расширения (выбранная скорость, привязки горячих
клавиш, положение ползунка, язык, переключатель «Запомнить скорость»,
список своих пресетов) сохраняются в
[`browser.storage.local`][storage-ru] — локальном хранилище,
выделенном расширению самим браузером. Данные никогда не покидают
ваше устройство.

### Отчёт диагностики

Во вкладке «Диагностика» в меню есть кнопка «Скопировать отчёт» —
она кладёт в ваш буфер обмена JSON-снимок состояния. Снимок содержит
домен (например, `rezka.ag`), путь страницы **без query-string и
URL-фрагмента**, ваш user agent, размер окна, текущее состояние
панели и недавние события смены скорости. Отчёт генерируется только
когда ВЫ нажмёте кнопку и кладётся только в ВАШ буфер обмена —
расширение само никуда его не отправляет. Вставьте его в GitHub
issue, если хотите отправить разработчику.

### Разрешения

| Разрешение | Зачем |
|---|---|
| `storage` | Сохранять ваши настройки между сессиями. |
| `host_permissions` (зеркала HDRezka) | Встраивать панель управления скоростью в плеер HDRezka. Расширение не работает на других сайтах. |

В Firefox-манифесте задекларировано
`browser_specific_settings.gecko.data_collection_permissions: { required: ['none'] }`,
чтобы листинг AMO мог автоматически проверить обещание о нулевом
сборе данных.

### Исходный код

Расширение распространяется как open source под лицензией
GNU General Public License v3.0 или позднее (GPL-3.0-or-later).
Исходники: [github.com/danscMax/HDRezkaSpeeds](https://github.com/danscMax/HDRezkaSpeeds).

### Контакты

Создавайте issue или задавайте вопросы в [GitHub-репозитории][issues-ru].

[storage-ru]: https://developer.mozilla.org/ru/docs/Mozilla/Add-ons/WebExtensions/API/storage/local
[issues-ru]: https://github.com/danscMax/HDRezkaSpeeds/issues
