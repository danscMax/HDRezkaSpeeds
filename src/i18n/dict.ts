/**
 * Bilingual dictionary (RU/EN). Ported from
 * `YouTube & HDRezka Speeds.user.js` lines 270-491 with three additions
 * needed by the extension:
 *
 *   - tm.detected.*       coexistence notification (Wave 1.0c)
 *   - migration.*         one-time TM-import notification (Wave 1.4)
 *   - settings.export/import   JSON migration UI (Wave 1.8b workaround for
 *                              GM-storage that the extension can't read; see
 *                              docs/MIGRATION.md)
 *
 * Contract (audit M3): every value is plain text. No `<`, `>`, `&` glyphs;
 * markup is built from trusted templates outside of i18n. Variable
 * interpolation uses `{name}` placeholders -- escape user-supplied values
 * BEFORE substituting them in.
 *
 * Adding a new key: add it to `en` first (the canonical surface), then to
 * `ru`. The DictKey type derives from `en`, so a missing English entry is a
 * compile error and a missing Russian entry is caught by the i18n.spec.ts
 * coverage test.
 */

export const I18N_DICT = {
  en: {
    // menu.*
    'menu.title': 'Playback Speed',
    'menu.version_tip': 'Script version',

    // tabs.*
    'tabs.general': 'General',
    'tabs.general.tip': 'Slider position, behavior and advanced options',
    'tabs.shortcuts': 'Keys',
    'tabs.shortcuts.tip': 'Keyboard shortcuts for changing playback speed',
    'tabs.diag': 'Diagnostics',
    'tabs.diag.tip': 'Script status, copy report, clear cache',

    // general.*
    'general.speed_presets': 'Speed buttons',
    'general.speed_presets.hint': 'Pick which speeds appear on the in-player panel.',
    'general.speed_presets.reset': 'Reset to defaults',
    'general.speed_presets.custom_placeholder': 'e.g. 1.1',
    'general.speed_presets.custom_add': 'Add',
    'general.speed_presets.custom_add.tip': 'Add a custom speed value (0.5x – 10x). Press Enter or click Add.',
    'toast.preset_invalid': 'Invalid speed value',
    'toast.preset_out_of_range': 'Speed must be between {min}x and {max}x',
    'toast.preset_duplicate': 'This speed is already on the list',

    // welcome.* — opens once on install via background.ts.
    // Body strings using **word** become <strong>word</strong> at render time;
    // \n becomes <br>. The 5-char `<` regex in i18n.spec.ts is unaffected
    // because we never embed literal HTML, only ASCII markers.
    'welcome.title': 'The speed you choose',
    'welcome.subtitle': '0.5–10x speed for HDRezka. No ads, no tracking.',
    'welcome.value': '⚡ Save time on long videos',
    'welcome.step1.title': 'Speed buttons in one click',
    'welcome.step1.body': 'Open HDRezka — the panel appears automatically next to the player.',
    'welcome.ann.clicks': '**Click** a speed — switch.\n**Double-click** — lock it in.',
    'welcome.ann.slider': '**Slider** — smooth speed, e.g. 1.7x or 2.3x.',
    'welcome.ann.gear': '**⚙ button** — keys, speeds, diagnostics.',
    'welcome.step2.title': 'Make it yours',
    'welcome.step2.body': 'All settings — one click away, without leaving the video.',
    'welcome.ann.help': '**?** — reopen this guide.',
    'welcome.ann.tabs': '**4 sections**: general, keys, diagnostics, support.',
    'welcome.ann.presets': '**Your speed set** — toggle or type manually (up to 10x).',
    'welcome.pin.tip': '**For quick access** — pin the extension to the toolbar.',
    'welcome.tips.reopen': '**Re-read** — click **?** in the settings window.',
    'welcome.hotkeys.title': 'Hotkeys',
    'welcome.hotkeys.body': 'Set your own keys and the speed step.',
    'welcome.hotkeys.faster': 'Speed up',
    'welcome.hotkeys.slower': 'Slow down',
    'welcome.hotkeys.placeholder': 'Press a key combination',
    'welcome.hotkeys.step_label': 'Step size',
    'welcome.hotkeys.step_help': 'How much is added/subtracted per press. From 0.01 (fine) to 1.0 (coarse).',
    'welcome.hotkeys.more': 'All shortcuts — in the «Keys» tab in settings.',
    'welcome.hotkeys.saved': 'Saved',
    'welcome.donate.title': 'If it is useful — support the developer',
    'welcome.donate.body': 'Any tip is welcome and genuinely motivating. No ads, no tracking.',
    'welcome.donate.cloudtips': 'Russian card · CloudTips',
    'welcome.donate.more': 'TON / USDT TRC20',
    'welcome.donate.more.tip': 'Click the extension icon → "Support" tab to view TON / USDT addresses.',
    'welcome.cta.hdrezka': 'Open HDRezka',
    'welcome.cta.gotit': 'Close',

    // panel.button.tooltip — title attribute on each speed-preset button.
    // Single line so the browser tooltip doesn't blow up.
    'panel.button.tooltip': 'Click — temporary speed for this video. Double-click — save as default.',
    'menu.help.tip': 'Open the welcome page',
    'general.slider_pos': 'Slider position',
    'general.pos.right': 'Right',
    'general.pos.right.tip': 'Slider on the right of the speed buttons',
    'general.pos.bottom': 'Below',
    'general.pos.bottom.tip': 'Slider on a separate row below the buttons',
    'general.pos.video': 'In player',
    'general.pos.video.tip': "Embed slider into the player's bottom control bar",

    // behavior.*
    'behavior.section': 'Behavior',
    'behavior.remember': 'Remember last speed',
    'behavior.remember.tip': 'Save the chosen speed and apply it to next videos automatically',

    // advanced.*
    'advanced.section': 'Advanced',
    'advanced.discovery': 'Auto-recover selectors',
    'advanced.discovery.hint': 'When the site updates and breaks our selectors, the script tries 5 strategies to find the player and panel automatically (cache, exact, substring, ancestor-of-video, geometric heuristic). Disable this if a bad cached selector keeps breaking the UI.',
    'advanced.healthcheck': 'Self-diagnostics',
    'advanced.healthcheck.hint': 'Periodically verifies that everything works (panel inserted, speed applied, no rate-resets storm). Shows a red dot on the gear button if something is wrong, with a detailed report on the Diagnostics tab.',

    // hotkeys.*
    'hotkeys.help': 'You can assign multiple combinations to one action -- for example, one for the keyboard and another for a remote. Click the field and press the keys you want.',
    'hotkeys.speedup_label': 'Speed up (+0.1)',
    'hotkeys.speeddown_label': 'Slow down (-0.1)',
    'hotkeys.placeholder': 'Click and press keys...',
    'hotkeys.input.tip': 'Click the field, then press the key combination you want',
    'hotkeys.remove.tip': 'Remove this shortcut',
    'hotkeys.add': 'Add shortcut',
    'hotkeys.add.tip': 'Add another key combination for this action (e.g. for both keyboard and remote control)',
    'hotkeys.reset': 'Reset to default',
    'hotkeys.reset.tip': 'Restore default shortcut',

    // diag.*
    'diag.btn.recheck': 'Run check',
    'diag.btn.recheck.tip': 'Run a status check right now and update the indicator above',
    'diag.btn.copy': 'Copy report',
    'diag.btn.copy.tip': 'Copy a detailed report to your clipboard. Send it to the developer if you have a bug to report.',
    'diag.btn.purge': 'Clear cache',
    'diag.btn.purge.tip': 'Delete remembered player selectors. Useful if the script picked the wrong element and keeps breaking the UI on every page load.',
    'diag.btn.full_reset': 'Reset everything',
    'diag.btn.full_reset.tip': 'Erase ALL settings and cache. The script returns to its fresh-install state. This cannot be undone.',
    'diag.btn.feedback': 'Send feedback',
    'diag.btn.feedback.tip': 'Open the feedback form to send a message to the developer (optionally attach the diagnostic report).',
    'feedback.title': 'Send feedback',
    'feedback.intro': 'Tell us what is broken, what you would like, or just say hi. The author reads every message and replies as time allows.',
    'feedback.rating.label': 'How is it going?',
    'feedback.rating.positive': 'Great',
    'feedback.rating.neutral': 'Okay',
    'feedback.rating.negative': 'Frustrating',
    'feedback.message.label': 'Your message',
    'feedback.message.placeholder': 'What happened, what you tried, what you expected to see…',
    'feedback.email.label': 'Email for reply (optional)',
    'feedback.email.placeholder': 'you@example.com',
    'feedback.email.hint': 'Leave blank if you do not want a personal reply. The author reads every message regardless.',
    'feedback.diag.label': 'Attach diagnostic report',
    'feedback.diag.hint': 'Anonymous: domain + page path (no query string), browser, viewport, panel state, recent rate-change events. Helps the author reproduce bugs.',
    'feedback.privacy': 'On Submit, your message goes to the author\'s personal Telegram inbox via a Cloudflare Worker. No third-party services, no analytics. See the Privacy Policy for the full list of fields transmitted.',
    'feedback.submit': 'Submit',
    'feedback.submitting': 'Sending…',
    'feedback.success.title': 'Thank you 🙏',
    'feedback.success.body': 'Your message reached the author. Bugs typically get a fix within a release; suggestions and praise get a smile and a slow-burn note in the roadmap.',
    'feedback.success.again': 'Send another',
    'feedback.success.close': 'Close',
    'feedback.error.title': 'Could not send',
    'feedback.error.network': 'Network error. Check your connection and try again.',
    'feedback.error.rate_limit': 'Slow down — limit is 5 messages per hour. Try later.',
    'feedback.error.validation': 'Some fields look wrong. Please review and resubmit.',
    'feedback.error.server': 'Server hiccup. The author has been notified; please try again in a minute.',
    'feedback.error.fallback': 'If the form keeps failing, write directly to {email}.',
    'feedback.retry': 'Try again',
    'diag.full_reset_confirm': 'Erase ALL settings and selector cache?\n\nThis cannot be undone -- you will lose your shortcuts, language preference, default speed, and discovery cache. Reload the page after the reset.',
    'diag.privacy': 'Reports do not include search queries or URL fragments -- only the domain and the page path.',

    // diag.status.*
    'diag.status.not_checked': 'Not checked yet',
    'diag.status.click_to_check': 'Click "Run check" to test now',
    'diag.status.ok': 'Everything is working',
    'diag.status.last_check': 'Last check: {time}',
    'diag.status.issue_single': 'Issue: {issue}',
    'diag.status.issues_count': '{count} issues found',
    'diag.status.try_again': 'Try "Clear cache" or "Run check" again. Copy the report if it persists.',
    'diag.status.waiting': 'Waiting for video playback',
    'diag.status.waiting_detail': 'Press play on the video to verify everything works',

    // diag.issue.*
    'diag.issue.video_not_found': "video element wasn't found",
    'diag.issue.player_not_found': "player wasn't found",
    'diag.issue.layout_unrecognised': "page layout wasn't recognised",
    'diag.issue.panel_not_inserted': "speed panel didn't appear on the page",
    'diag.issue.speed_not_applied': "playback speed isn't being applied",
    'diag.issue.rate_resets': 'the site keeps resetting your speed',

    // lang.*
    'lang.section_label': 'Language',
    'lang.tooltip_en': 'Switch interface to English',
    'lang.tooltip_ru': 'Switch interface to Russian',

    // toast.*
    'toast.speed_global': 'Speed {speed}x saved as default',
    'toast.shortcut_min': 'At least one shortcut must remain',
    'toast.discovery_on': 'Auto-recover enabled',
    'toast.discovery_off': 'Auto-recover disabled',
    'toast.healthcheck_on': 'Self-diagnostics enabled',
    'toast.healthcheck_off': 'Self-diagnostics disabled',
    'toast.title_hidden': 'Player title hidden',
    'toast.title_shown': 'Player title shown',
    'toast.premium_hidden': 'Premium banners hidden',
    'toast.premium_shown': 'Premium banners shown',
    'toast.diag_ok': 'Everything is working',
    'toast.diag_issues': 'Issues detected -- see Diagnostics tab',
    'toast.diag_waiting': 'Waiting -- start the video first',
    'toast.report_copied': 'Report copied to clipboard',
    'toast.report_copied_short': 'Report copied',
    'toast.report_copy_failed': 'Failed to copy report',
    'toast.cache_cleared': 'Selector cache cleared',
    'toast.reset_done': 'Reset complete -- please reload the page',
    'toast.reset_failed': 'Reset failed: {message}',
    'toast.lang_switched': 'Language switched to English',

    // confirm.*
    'confirm.full_reset': 'Reset everything: all settings and cache will be erased. Continue?',

    // tm.detected.* -- audit C3/H8, surfaced when the userscript is also active.
    'tm.detected.title': 'Userscript already active',
    'tm.detected.body': 'The Tampermonkey userscript and the extension are both running. Disable one of them to avoid duplicate UI and conflicting hotkeys.',

    // migration.* -- audit C5, fired once after first-run TM data import succeeds.
    'migration.tm_imported': 'Imported settings from the previous Tampermonkey installation.',

    // settings.export / import -- Wave 1.8b, manual fallback for the
    // GM-storage data the extension cannot read directly.
    'settings.export': 'Export settings',
    'settings.export.tip': 'Save current settings as a JSON file you can import later or on another browser.',
    'settings.import': 'Import settings',
    'settings.import.tip': 'Load settings from a JSON file previously exported by the userscript or extension.',
    'settings.import.success': 'Settings imported successfully',
    'settings.import.failure': 'Import failed: {message}',

    // donate.* -- support the developer (audit Wave VI). Three options:
    // CloudTips for Russian cards, TON / USDT TRC20 for international.
    'tabs.donate': 'Support',
    'tabs.donate.tip': 'Support the developer',
    'donate.thanks': 'If the extension is useful to you — any tip is welcome and very motivating.',
    'donate.cloudtips': 'Russian card',
    'donate.cloudtips.tip': 'Pay by Russian card via CloudTips. Opens in a new tab.',
    'donate.ton': 'Toncoin (TON)',
    'donate.ton.tip': 'Show TON address',
    'donate.ton.description': 'Free · ~5 sec',
    'donate.usdt': 'USDT (TRC20)',
    'donate.usdt.tip': 'Show USDT TRC20 address',
    'donate.usdt.description': '~$1-3 fee · ~3 sec',
    'donate.crypto.step1': '1. Install a wallet:',
    'donate.crypto.step2': '2. Copy this address:',
    'donate.crypto.step3': '3. In the wallet — tap "Send", paste the address, enter any amount, confirm.',
    'donate.crypto.copy': 'Copy',
    'donate.crypto.copied': 'Copied',
    'donate.crypto.address_label': 'Wallet address',
    'donate.ton.wallet_name': 'Tonkeeper',
    'donate.usdt.wallet_name': 'Trust Wallet',
    'toast.address_copied': 'Wallet address copied',
    'toast.copy_failed': 'Could not copy — please copy the address manually',
  },
  ru: {
    // menu.*
    'menu.title': 'Скорость воспроизведения',
    'menu.version_tip': 'Версия скрипта',

    // tabs.*
    'tabs.general': 'Общие',
    'tabs.general.tip': 'Положение ползунка, поведение и расширенные опции',
    'tabs.shortcuts': 'Клавиши',
    'tabs.shortcuts.tip': 'Горячие клавиши для управления скоростью',
    'tabs.diag': 'Диагностика',
    'tabs.diag.tip': 'Статус скрипта, копирование отчёта, очистка кеша',

    // general.*
    'general.speed_presets': 'Кнопки скорости',
    'general.speed_presets.hint': 'Выберите какие скорости показывать на панели плеера.',
    'general.speed_presets.reset': 'Вернуть по умолчанию',
    'general.speed_presets.custom_placeholder': 'Например, 1.1',
    'general.speed_presets.custom_add': 'Добавить',
    'general.speed_presets.custom_add.tip': 'Добавить свою скорость (0.5x – 10x). Enter или клик «Добавить».',
    'toast.preset_invalid': 'Неверное значение скорости',
    'toast.preset_out_of_range': 'Скорость должна быть от {min}x до {max}x',
    'toast.preset_duplicate': 'Эта скорость уже в списке',

    // welcome.*
    'welcome.title': 'Скорость, которую выбираете Вы',
    'welcome.subtitle': 'Скорость 0.5–10x для HDRezka. Без рекламы и трекинга.',
    'welcome.value': '⚡ Экономьте время на длинных видео',
    'welcome.step1.title': 'Кнопки скорости в один клик',
    'welcome.step1.body': 'Откройте HDRezka — панель встраивается автоматически рядом с плеером.',
    'welcome.ann.clicks': '**Клик** на скорость — переключиться.\n**Двойной клик** — закрепить навсегда.',
    'welcome.ann.slider': '**Ползунок** — плавная скорость, например 1.7x или 2.3x.',
    'welcome.ann.gear': '**Кнопка ⚙** — клавиши, скорости, диагностика.',
    'welcome.step2.title': 'Любые кнопки, любые скорости',
    'welcome.step2.body': 'Все настройки — за один клик, не покидая видео.',
    'welcome.ann.help': '**?** — снова открыть это руководство.',
    'welcome.ann.tabs': '**4 раздела**: общие, клавиши, диагностика, поддержка.',
    'welcome.ann.presets': '**Свой набор скоростей** — отметить или ввести вручную (до 10x).',
    'welcome.pin.tip': '**Чтобы быстрее находить** — закрепите расширение в верхней панели браузера.',
    'welcome.tips.reopen': '**Перечитать** — кликнуть **?** в окне настроек.',
    'welcome.hotkeys.title': 'Горячие клавиши',
    'welcome.hotkeys.body': 'Назначьте свои клавиши и шаг скорости.',
    'welcome.hotkeys.faster': 'Ускорить',
    'welcome.hotkeys.slower': 'Замедлить',
    'welcome.hotkeys.placeholder': 'Нажмите комбинацию клавиш',
    'welcome.hotkeys.step_label': 'Шаг изменения',
    'welcome.hotkeys.step_help': 'Сколько прибавляется/вычитается за нажатие. От 0.01 (тонко) до 1.0 (грубо).',
    'welcome.hotkeys.more': 'Все хоткеи — во вкладке «Клавиши» в настройках.',
    'welcome.hotkeys.saved': 'Сохранено',
    'welcome.donate.title': 'Если расширение полезно — поддержите автора',
    'welcome.donate.body': 'Любая сумма приветствуется и очень мотивирует. Никакой рекламы, никакого трекинга.',
    'welcome.donate.cloudtips': 'Картой РФ · CloudTips',
    'welcome.donate.more': 'TON / USDT TRC20',
    'welcome.donate.more.tip': 'Кликните иконку расширения → вкладка «Поддержать», там адреса TON / USDT.',
    'welcome.cta.hdrezka': 'Открыть HDRezka',
    'welcome.cta.gotit': 'Закрыть',

    'panel.button.tooltip': 'Клик — временно для этого видео. Двойной клик — сохранить как основную.',
    'menu.help.tip': 'Открыть страницу с подсказками',
    'general.slider_pos': 'Положение ползунка',
    'general.pos.right': 'Справа',
    'general.pos.right.tip': 'Ползунок справа от кнопок скорости',
    'general.pos.bottom': 'Снизу',
    'general.pos.bottom.tip': 'Ползунок на отдельной строке под кнопками',
    'general.pos.video': 'В плеере',
    'general.pos.video.tip': 'Встроить ползунок в нижнюю панель плеера',

    // behavior.*
    'behavior.section': 'Поведение',
    'behavior.remember': 'Запоминать последнюю скорость',
    'behavior.remember.tip': 'Сохранять выбранную скорость и автоматически применять её к следующим видео',

    // advanced.*
    'advanced.section': 'Расширенные',
    'advanced.discovery': 'Авто-восстановление селекторов',
    'advanced.discovery.hint': 'Когда сайт обновляется и ломает наши селекторы, скрипт пробует 5 стратегий поиска плеера и панели автоматически (кеш, точное совпадение, подстрока, предок видео, геометрическая эвристика). Отключите, если повреждённый кеш постоянно ломает интерфейс.',
    'advanced.healthcheck': 'Самодиагностика',
    'advanced.healthcheck.hint': 'Периодически проверяет, что всё работает (панель встроена, скорость применяется, нет шторма сбросов). Показывает красную точку на шестерёнке, если что-то не так, с подробным отчётом во вкладке «Диагностика».',

    // hotkeys.*
    'hotkeys.help': 'Можно назначить несколько комбинаций на одно действие -- например, одну для клавиатуры, другую для пульта. Кликните по полю и нажмите нужные клавиши.',
    'hotkeys.speedup_label': 'Ускорить (+0.1)',
    'hotkeys.speeddown_label': 'Замедлить (-0.1)',
    'hotkeys.placeholder': 'Кликните и нажмите клавиши...',
    'hotkeys.input.tip': 'Кликните по полю и нажмите нужное сочетание клавиш',
    'hotkeys.remove.tip': 'Удалить эту комбинацию',
    'hotkeys.add': 'Добавить комбинацию',
    'hotkeys.add.tip': 'Добавить ещё одну комбинацию для этого действия (например, для клавиатуры и пульта)',
    'hotkeys.reset': 'Сбросить по умолчанию',
    'hotkeys.reset.tip': 'Восстановить сочетание по умолчанию',

    // diag.*
    'diag.btn.recheck': 'Проверить',
    'diag.btn.recheck.tip': 'Запустить проверку прямо сейчас и обновить индикатор выше',
    'diag.btn.copy': 'Копировать отчёт',
    'diag.btn.copy.tip': 'Скопировать подробный отчёт в буфер обмена. Отправьте разработчику, если хотите сообщить об ошибке.',
    'diag.btn.purge': 'Очистить кеш',
    'diag.btn.purge.tip': 'Удалить запомненные селекторы плеера. Полезно, если скрипт выбрал не тот элемент и постоянно ломает интерфейс при каждой загрузке.',
    'diag.btn.full_reset': 'Сбросить всё',
    'diag.btn.full_reset.tip': 'Стереть ВСЕ настройки и кеш. Скрипт вернётся в состояние свежей установки. Это действие нельзя отменить.',
    'diag.btn.feedback': 'Связаться с автором',
    'diag.btn.feedback.tip': 'Открыть форму обратной связи — отправить сообщение автору (по желанию приложить диагностический отчёт).',
    'feedback.title': 'Связаться с автором',
    'feedback.intro': 'Напишите, что сломалось, что хочется или просто привет. Автор читает каждое сообщение и отвечает по мере возможности.',
    'feedback.rating.label': 'Как впечатления?',
    'feedback.rating.positive': 'Отлично',
    'feedback.rating.neutral': 'Норм',
    'feedback.rating.negative': 'Плохо',
    'feedback.message.label': 'Ваше сообщение',
    'feedback.message.placeholder': 'Что произошло, что вы пробовали, что ожидали увидеть…',
    'feedback.email.label': 'Email для ответа (необязательно)',
    'feedback.email.placeholder': 'you@example.com',
    'feedback.email.hint': 'Оставьте пустым, если личный ответ не нужен. Автор всё равно прочитает сообщение.',
    'feedback.diag.label': 'Приложить диагностический отчёт',
    'feedback.diag.hint': 'Анонимный: домен + путь страницы (без query-string), браузер, размер окна, состояние панели, недавние события смены скорости. Помогает воспроизвести ошибку.',
    'feedback.privacy': 'При нажатии «Отправить» ваше сообщение через Cloudflare Worker уходит в личный Telegram автора. Никаких третьих сервисов, никакой аналитики. Полный список передаваемых полей — в Privacy Policy.',
    'feedback.submit': 'Отправить',
    'feedback.submitting': 'Отправка…',
    'feedback.success.title': 'Спасибо 🙏',
    'feedback.success.body': 'Ваше сообщение доставлено автору. Баги обычно чинятся к следующему релизу; идеи и слова поддержки — встречают улыбку и медленно превращаются в пункты roadmap.',
    'feedback.success.again': 'Отправить ещё',
    'feedback.success.close': 'Закрыть',
    'feedback.error.title': 'Не удалось отправить',
    'feedback.error.network': 'Ошибка сети. Проверьте подключение и попробуйте снова.',
    'feedback.error.rate_limit': 'Не так быстро — лимит 5 сообщений в час. Попробуйте позже.',
    'feedback.error.validation': 'Некоторые поля выглядят неправильно. Проверьте и попробуйте снова.',
    'feedback.error.server': 'Сбой сервера. Автор уже уведомлён, попробуйте через минуту.',
    'feedback.error.fallback': 'Если форма всё равно не работает — напишите напрямую на {email}.',
    'feedback.retry': 'Попробовать снова',
    'diag.full_reset_confirm': 'Удалить ВСЕ настройки и кеш селекторов?\n\nЭто действие нельзя отменить -- вы потеряете горячие клавиши, выбор языка, скорость по умолчанию и кеш discovery. После сброса перезагрузите страницу.',
    'diag.privacy': 'Отчёты не содержат поисковых запросов и фрагментов URL -- только домен и путь страницы.',

    // diag.status.*
    'diag.status.not_checked': 'Ещё не проверено',
    'diag.status.click_to_check': 'Нажмите «Проверить», чтобы запустить сейчас',
    'diag.status.ok': 'Всё работает',
    'diag.status.last_check': 'Последняя проверка: {time}',
    'diag.status.issue_single': 'Проблема: {issue}',
    'diag.status.issues_count': 'Найдено проблем: {count}',
    'diag.status.try_again': 'Попробуйте «Очистить кеш» или «Проверить» ещё раз. Скопируйте отчёт, если проблема сохраняется.',
    'diag.status.waiting': 'Ожидание запуска видео',
    'diag.status.waiting_detail': 'Запустите видео, чтобы проверить, что всё работает',

    // diag.issue.*
    'diag.issue.video_not_found': 'элемент видео не найден',
    'diag.issue.player_not_found': 'плеер не найден',
    'diag.issue.layout_unrecognised': 'разметка страницы не распознана',
    'diag.issue.panel_not_inserted': 'панель скорости не появилась на странице',
    'diag.issue.speed_not_applied': 'скорость воспроизведения не применяется',
    'diag.issue.rate_resets': 'сайт постоянно сбрасывает скорость',

    // lang.*
    'lang.section_label': 'Язык',
    'lang.tooltip_en': 'Переключить интерфейс на английский',
    'lang.tooltip_ru': 'Переключить интерфейс на русский',

    // toast.*
    'toast.speed_global': 'Скорость {speed}x сохранена как глобальная',
    'toast.shortcut_min': 'Должна остаться хотя бы одна комбинация',
    'toast.discovery_on': 'Авто-восстановление включено',
    'toast.discovery_off': 'Авто-восстановление выключено',
    'toast.healthcheck_on': 'Самодиагностика включена',
    'toast.healthcheck_off': 'Самодиагностика выключена',
    'toast.title_hidden': 'Заголовок плеера скрыт',
    'toast.title_shown': 'Заголовок плеера показан',
    'toast.premium_hidden': 'Premium-баннеры скрыты',
    'toast.premium_shown': 'Premium-баннеры показаны',
    'toast.diag_ok': 'Всё работает',
    'toast.diag_issues': 'Обнаружены проблемы -- см. вкладку «Диагностика»',
    'toast.diag_waiting': 'Ожидание -- сначала запустите видео',
    'toast.report_copied': 'Отчёт скопирован в буфер обмена',
    'toast.report_copied_short': 'Отчёт скопирован',
    'toast.report_copy_failed': 'Не удалось скопировать отчёт',
    'toast.cache_cleared': 'Кеш селекторов очищен',
    'toast.reset_done': 'Сброс выполнен -- пожалуйста, перезагрузите страницу',
    'toast.reset_failed': 'Ошибка сброса: {message}',
    'toast.lang_switched': 'Язык переключён на русский',

    // confirm.*
    'confirm.full_reset': 'Сбросить всё: все настройки и кеш будут стёрты. Продолжить?',

    // tm.detected.*
    'tm.detected.title': 'Пользовательский скрипт уже работает',
    'tm.detected.body': 'Tampermonkey-скрипт и расширение запущены одновременно. Отключите один из них, чтобы избежать дублирования интерфейса и конфликтов горячих клавиш.',

    // migration.*
    'migration.tm_imported': 'Настройки из предыдущей установки Tampermonkey успешно импортированы.',

    // settings.export / import
    'settings.export': 'Экспортировать настройки',
    'settings.export.tip': 'Сохранить текущие настройки в JSON-файл для последующего импорта или переноса в другой браузер.',
    'settings.import': 'Импортировать настройки',
    'settings.import.tip': 'Загрузить настройки из JSON-файла, ранее экспортированного из скрипта или расширения.',
    'settings.import.success': 'Настройки успешно импортированы',
    'settings.import.failure': 'Ошибка импорта: {message}',

    // donate.*
    'tabs.donate': 'Поддержать',
    'tabs.donate.tip': 'Поддержать разработчика',
    'donate.thanks': 'Если расширение вам полезно — любая поддержка приветствуется и очень мотивирует.',
    'donate.cloudtips': 'Картой РФ',
    'donate.cloudtips.tip': 'Оплата картой РФ через CloudTips. Откроется в новой вкладке.',
    'donate.ton': 'Toncoin (TON)',
    'donate.ton.tip': 'Показать адрес TON',
    'donate.ton.description': 'Бесплатно · ~5 сек',
    'donate.usdt': 'USDT (TRC20)',
    'donate.usdt.tip': 'Показать адрес USDT TRC20',
    'donate.usdt.description': '~$1-3 комиссия · ~3 сек',
    'donate.crypto.step1': '1. Установите кошелёк:',
    'donate.crypto.step2': '2. Скопируйте этот адрес:',
    'donate.crypto.step3': '3. В кошельке — нажмите «Отправить», вставьте адрес, введите сумму и подтвердите.',
    'donate.crypto.copy': 'Скопировать',
    'donate.crypto.copied': 'Скопировано',
    'donate.crypto.address_label': 'Адрес кошелька',
    'donate.ton.wallet_name': 'Tonkeeper',
    'donate.usdt.wallet_name': 'Trust Wallet',
    'toast.address_copied': 'Адрес скопирован',
    'toast.copy_failed': 'Не удалось скопировать — скопируйте вручную',
  },
} as const;

export const SUPPORTED_LANGS = ['en', 'ru'] as const;

export type Lang = (typeof SUPPORTED_LANGS)[number];

/** All translation keys. Derived from the canonical English dictionary so a
 *  missing English entry is a compile error. */
export type DictKey = keyof (typeof I18N_DICT)['en'];
