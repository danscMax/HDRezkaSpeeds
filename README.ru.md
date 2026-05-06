# HDRezka Speed Controller

[English](README.md) | **Русский**

Расширение для браузера (Chrome MV3 + Firefox MV3), которое добавляет
всегда видимую панель кнопок скорости, точный ползунок и
настраиваемые горячие клавиши в плеер HDRezka.

Двуязычный интерфейс (English / Русский). Без рекламы, без
телеметрии.

## Возможности

- 11 кнопок скорости (1.0x – 2.0x с шагом 0.1), подобранных под
  просмотр фильмов. Можно добавить любое своё значение до 10x.
- Ползунок для промежуточных значений с цветной заливкой,
  отражающей текущую скорость.
- Один клик — временная скорость для этого видео. Двойной клик —
  сохранить как основную.
- Настраиваемые горячие клавиши (по умолчанию `Ctrl+C` +0.1 /
  `Ctrl+V` −0.1). Можно назначить несколько комбинаций на одно
  действие (клавиатура + пульт).
- Меню на шестерёнке: вкладки «Общие» / «Клавиши» / «Диагностика».
- Иконка в тулбаре открывает то же меню без открытия видео.
- Автоматически следует за темой HDRezka — переключение светлый/
  тёмный режим панель подхватывает «на лету».
- Поддержка всех известных зеркал: `hdrezka.ag`, `rezka.ag`,
  `hdrezka.me`, `hdrezka.co`, `hdrezka.website`, `hdrezka.cm`,
  `hdrezka-home.tv`, `rezkify.com`, `rezkery.com`, `kinopub.me`.

## Надёжность

Когда HDRezka меняет вёрстку, панель восстанавливается автоматически
через цепочку из пяти стратегий поиска (кеш → точное совпадение →
подстрока → подъём от `<video>` → геометрическая эвристика).
Встроенный watchdog обнаруживает поломки, очищает плохой кеш и
переустанавливает панель. Сохранение скорости Plyr перехватывается,
поэтому плеер не сбрасывает выбранную скорость на каждой смене
серии.

## Приватность

- Все настройки хранятся локально в `browser.storage.local`.
- Никакой телеметрии, никакой аналитики, никаких удалённых вызовов.
- Декларация AMO `data_collection_permissions`: `none`.

См. [PRIVACY.md](./PRIVACY.md).

## Установка

- **Chrome Web Store** — *(на ревью)*
- **Firefox AMO** — *(на ревью)*

Ручная установка из исходников (пока листинги не одобрены):

```bash
git clone https://github.com/danscMax/HDRezkaSpeeds.git
cd HDRezkaSpeeds
npm install
npm run build           # → .output/chrome-mv3/
npm run build:firefox   # → .output/firefox-mv3/
```

Затем в Chrome → `chrome://extensions` → включить «Режим
разработчика» → «Загрузить распакованное расширение» → указать на
`.output/chrome-mv3/`. В Firefox → `about:debugging` → «Этот
Firefox» → «Загрузить временное дополнение…» → выбрать
`.output/firefox-mv3/manifest.json`.

## Разработка

```bash
npm run dev             # Chrome MV3 с горячей перезагрузкой
npm run dev:firefox     # Firefox MV3 с горячей перезагрузкой
npm run typecheck       # tsc --noEmit
npm run test            # vitest unit-тесты
```

## Структура проекта

- `src/sites/` — bootstrap для HDRezka, патч localStorage Plyr, allow-
  list URL (`/films/*.html`, `/series/*.html` и т.д.).
- `src/discovery/` — многострочный resolver DOM-элементов плеера и
  info-блоков.
- `src/ui/` — панель, ползунок, меню настроек, детекция темы.
- `src/storage/` — хранилища настроек и скорости поверх
  `browser.storage.local`.
- `src/health/` — watchdog + структурированный отчёт диагностики.
- `src/i18n/` — двуязычный словарь (EN/RU).
- `src/entrypoints/` — content script, background SW, popup, welcome.
- `tests/store-screenshots/` — Playwright-скрипт, который генерирует
  четыре скриншота для листингов в `dist-store-assets/screenshots/`.

## Связанный проект

[VideoSpeeds](https://github.com/danscMax/VideoSpeeds) — тот же
контроллер для **YouTube + RuTube**. Два расширения сделаны
отдельно, чтобы каждое могло объявлять узкие `host_permissions` в
манифесте — это ускоряет ревью в Chrome Web Store и AMO.

## Лицензия

GPL-3.0-or-later. См. [LICENSE](./LICENSE).
