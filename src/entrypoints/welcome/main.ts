/**
 * Welcome page renderer. Opened in a new tab on first install via
 * background.ts -> chrome.runtime.onInstalled.
 *
 * v0.1.42 redesign — instead of abstract "tip cards", the page renders
 * HTML/CSS replicas of the actual in-player panel and settings menu, with
 * inline annotations pointing at the real interactions. The user reads
 * "this is what you got, here is what each thing does" rather than
 * decoding paraphrased text — the rendering on the welcome page IS the
 * teaching.
 *
 * Built programmatically with our DOM helpers (no innerHTML / no
 * createContextualFragment) so this entrypoint stays parser-API-free
 * and Mozilla's static analyzer doesn't flag it.
 */

import { storageKeysFor } from '../../config';
import { detectBrowserLang } from '../../i18n/detect';
import { type Lang, SUPPORTED_LANGS } from '../../i18n/dict';
import { createTranslator } from '../../i18n/translator';
import { captureHotkey, formatHotkey } from '../../speed/hotkeys';
import { createBrowserStorageAdapter } from '../../storage/adapter';
import { defaultSettings, type Settings } from '../../storage/types';
import { type HChild, h, svgEl } from '../../ui/dom-h';
import { vsFilledGearIcon, vsIcon } from '../../ui/icons';

declare const __VS_VERSION__: string | undefined;
const SCRIPT_VERSION = typeof __VS_VERSION__ === 'string' ? __VS_VERSION__ : '0.1.0';

type T = (key: string) => string;

const root = document.getElementById('welcome-app');
if (root) void renderWelcome(root);

async function renderWelcome(host: HTMLElement, langOverride?: Lang): Promise<void> {
  const adapter = createBrowserStorageAdapter();

  // Read language from storage if previously chosen, otherwise auto-detect.
  // Either site's `settings.language` holds the user's preference (welcome
  // mirrors the same value to both sites). This lets a re-opened welcome
  // honour the explicit choice the user made on first install.
  const storedEarly =
    (await adapter.get<Partial<Settings> | null>(storageKeysFor('hdrezka').settings, null)) ?? {};
  const detected = detectBrowserLang();
  const storedLang =
    typeof storedEarly.language === 'string' &&
    (SUPPORTED_LANGS as readonly string[]).includes(storedEarly.language)
      ? (storedEarly.language as Lang)
      : null;
  const lang: Lang = langOverride ?? storedLang ?? detected;
  const { t } = createTranslator(lang);
  // Match the html lang attribute to the rendered language so screen
  // readers don't try to pronounce Russian content with English phonemes.
  document.documentElement.lang = lang;
  document.title = t('welcome.title');

  // Welcome page is in its own tab — no host site to follow. Use the
  // OS-level preferred color scheme. Re-apply on system theme flip.
  const themeMql = window.matchMedia('(prefers-color-scheme: light)');
  const applyTheme = (mql: MediaQueryList | MediaQueryListEvent) => {
    document.documentElement.dataset.vsTheme = mql.matches ? 'light' : 'dark';
  };
  applyTheme(themeMql);
  themeMql.addEventListener('change', applyTheme);

  const fallbackSettings = defaultSettings(lang, 'hdrezka');
  const liveSettings: Settings = { ...fallbackSettings, ...storedEarly };

  // Persist welcome-page edits to the single supported site (HDRezka).
  async function applyPatch(patch: Partial<Settings>): Promise<void> {
    const key = storageKeysFor('hdrezka').settings;
    const fallback = defaultSettings(lang, 'hdrezka');
    const cur = (await adapter.get<Partial<Settings> | null>(key, null)) ?? {};
    const next: Settings = { ...fallback, ...cur, ...patch };
    await adapter.set(key, next);
  }

  // ----- Language switcher (top-right fixed) -----
  function onLangChange(newLang: Lang): void {
    void applyPatch({ language: newLang }).then(() => {
      void renderWelcome(host, newLang);
    });
  }

  host.replaceChildren(
    renderLangSwitch(t, lang, onLangChange),
    renderHero(t),
    renderBlockA(t),
    renderHotkeys(t, liveSettings, applyPatch),
    renderBlockB(t),
    renderTips(t),
    renderDonate(t),
    renderCta(t),
    h('div', { class: 'welcome-version' }, `v${SCRIPT_VERSION} · hdrezka-speeds`),
  );

  wireHoverGroups(host);
  // SVG-based connectors after layout settles. Use rAF so the browser has
  // committed the geometry from replaceChildren above before we measure.
  requestAnimationFrame(() => {
    for (const stage of host.querySelectorAll<HTMLElement>('.real-stage, .real-stage-settings')) {
      wireConnectors(stage);
    }
  });
}

/* ─── Language switcher ────────────────────────────────────────────── */

function renderLangSwitch(t: T, current: Lang, onChange: (lang: Lang) => void): HTMLElement {
  const button = (lang: Lang, label: string, tipKey: string) => {
    const btn = h(
      'button',
      {
        type: 'button',
        class: lang === current ? 'lang-btn active' : 'lang-btn',
        'aria-pressed': lang === current ? 'true' : 'false',
        title: t(tipKey),
      },
      label,
    );
    btn.addEventListener('click', () => {
      if (lang !== current) onChange(lang);
    });
    return btn;
  };
  return h(
    'div',
    { class: 'lang-switcher', role: 'group', 'aria-label': 'Language' },
    button('en', 'EN', 'lang.tooltip_en'),
    button('ru', 'RU', 'lang.tooltip_ru'),
  );
}

/* ─── SVG connector overlay ────────────────────────────────────────── *
 *
 * Each annotation has data-ann-group="<key>"; the matching UI part(s)
 * carry the same attribute. `wireConnectors()` finds each annotation,
 * picks the first non-annotation peer in the same stage, and draws a
 * dashed orthogonal path from annotation edge to target edge so the
 * "this label points at THAT thing" relationship is visible from the
 * static layout — not just on hover.
 *
 * Recomputed via ResizeObserver so the path stays correct when the user
 * resizes the window or the language switch changes text length.
 */
function wireConnectors(stage: HTMLElement): void {
  let svg = stage.querySelector<SVGSVGElement>(':scope > svg.connectors');
  if (!svg) {
    svg = svgEl('svg', {
      class: 'connectors',
      'aria-hidden': 'true',
    }) as SVGSVGElement;
    stage.appendChild(svg);
  }

  function redraw(): void {
    const stageRect = stage.getBoundingClientRect();
    if (stageRect.width === 0 || stageRect.height === 0) return;
    svg!.setAttribute('viewBox', `0 0 ${stageRect.width} ${stageRect.height}`);
    svg!.setAttribute('width', String(stageRect.width));
    svg!.setAttribute('height', String(stageRect.height));
    svg!.replaceChildren();

    for (const ann of stage.querySelectorAll<HTMLElement>('.annotation[data-ann-group]')) {
      const group = ann.dataset.annGroup;
      if (!group) continue;
      const target = stage.querySelector<HTMLElement>(
        `[data-ann-group="${group}"]:not(.annotation)`,
      );
      if (!target) continue;

      const ar = ann.getBoundingClientRect();
      const tr = target.getBoundingClientRect();

      // Pick attachment edges based on which side of the target the
      // annotation sits on.
      let ax: number, ay: number, tx: number, ty: number;
      let orientation: 'h' | 'v';
      if (ar.right <= tr.left + 4) {
        // annotation is left of target -> horizontal connector
        ax = ar.right - stageRect.left;
        ay = ar.top + ar.height / 2 - stageRect.top;
        tx = tr.left - stageRect.left;
        ty = tr.top + tr.height / 2 - stageRect.top;
        orientation = 'h';
      } else if (ar.left + 4 >= tr.right) {
        // annotation is right of target -> horizontal connector
        ax = ar.left - stageRect.left;
        ay = ar.top + ar.height / 2 - stageRect.top;
        tx = tr.right - stageRect.left;
        ty = tr.top + tr.height / 2 - stageRect.top;
        orientation = 'h';
      } else if (ar.top >= tr.bottom) {
        // annotation below target -> vertical connector
        ax = ar.left + ar.width / 2 - stageRect.left;
        ay = ar.top - stageRect.top;
        tx = tr.left + tr.width / 2 - stageRect.left;
        ty = tr.bottom - stageRect.top;
        orientation = 'v';
      } else if (ar.bottom <= tr.top) {
        // annotation above target -> vertical connector
        ax = ar.left + ar.width / 2 - stageRect.left;
        ay = ar.bottom - stageRect.top;
        tx = tr.left + tr.width / 2 - stageRect.left;
        ty = tr.top - stageRect.top;
        orientation = 'v';
      } else {
        // overlapping or weird placement — skip
        continue;
      }

      // Build an orthogonal "L" path so misaligned ends still look intentional.
      let d: string;
      if (orientation === 'h') {
        const midX = (ax + tx) / 2;
        d = `M ${ax} ${ay} L ${midX} ${ay} L ${midX} ${ty} L ${tx} ${ty}`;
      } else {
        const midY = (ay + ty) / 2;
        d = `M ${ax} ${ay} L ${ax} ${midY} L ${tx} ${midY} L ${tx} ${ty}`;
      }

      svg!.appendChild(
        svgEl('path', {
          d,
          fill: 'none',
          stroke: 'rgba(255, 72, 112, 0.55)',
          'stroke-width': 1,
          'stroke-dasharray': '3 3',
          'stroke-linecap': 'round',
        }),
      );
      // Tiny dot at the target endpoint so the eye lands on the actual
      // target rather than just "near" it.
      svg!.appendChild(
        svgEl('circle', {
          cx: tx,
          cy: ty,
          r: 2.5,
          fill: 'rgba(255, 72, 112, 0.85)',
        }),
      );
    }
  }

  redraw();
  // Recompute on resize. Observe the stage itself; ResizeObserver fires
  // for dimension changes including viewport zoom.
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => redraw());
    ro.observe(stage);
  }
  // Web fonts can shift text widths after first paint — redraw once they
  // settle so the connectors land on the post-font-loaded boxes.
  if ('fonts' in document) {
    void document.fonts.ready.then(() => redraw());
  }
}

/**
 * Two-way hover linking between annotations and the UI parts they
 * describe. Hovering an annotation highlights the matching pills /
 * slider / gear / tabs / preset section, and vice versa — same group
 * lights up regardless of which side initiates.
 */
function wireHoverGroups(rootEl: HTMLElement): void {
  const groups = new Map<string, HTMLElement[]>();
  rootEl.querySelectorAll<HTMLElement>('[data-ann-group]').forEach((el) => {
    const g = el.dataset.annGroup!;
    let bucket = groups.get(g);
    if (!bucket) {
      bucket = [];
      groups.set(g, bucket);
    }
    bucket.push(el);
  });
  for (const peers of groups.values()) {
    const on = () => {
      for (const p of peers) p.classList.add('vs-hover');
    };
    const off = () => {
      for (const p of peers) p.classList.remove('vs-hover');
    };
    for (const el of peers) {
      el.addEventListener('mouseenter', on);
      el.addEventListener('mouseleave', off);
      // Mirror on focus/blur so keyboard and AT users get the same
      // teaching link. Annotations are made focusable in the helper
      // below; mock UI parts already carry tabindex=-1, so focus only
      // fires on annotations — that's intended.
      el.addEventListener('focus', on);
      el.addEventListener('blur', off);
    }
  }
}

/* ─── Hero ─────────────────────────────────────────────────────────── */

function renderHero(t: T): HTMLElement {
  return h(
    'div',
    { class: 'welcome-hero' },
    h('div', { class: 'welcome-icon' }, vsFilledGearIcon(48)),
    h('h1', { class: 'welcome-title' }, t('welcome.title')),
    h('p', { class: 'welcome-sub' }, t('welcome.subtitle')),
    h('p', { class: 'welcome-value' }, t('welcome.value')),
    h(
      'div',
      { class: 'welcome-sites' },
      h(
        'span',
        { class: 'welcome-site-pill', 'data-site': 'hdrezka' },
        h('span', { class: 'dot' }),
        h('strong', {}, 'HDRezka'),
      ),
    ),
  );
}

/* ─── Annotation helper (used by both Block A and Block B) ─────────── */

function annotation(positionClass: string, text: string): HTMLElement {
  // "ann-clicks" -> "clicks". The same group string is set on the matching
  // UI parts so wireHoverGroups() can pair them.
  const group = positionClass.replace(/^ann-/, '');
  return h(
    'div',
    {
      class: `annotation ${positionClass}`,
      'data-ann-group': group,
      // Make annotations focusable — keyboard/AT users tab through them
      // and the focus handler in wireHoverGroups() lights up the matching
      // UI part. role=button + aria-label tell SR users this thing has
      // an effect when activated.
      tabindex: 0,
      role: 'button',
    },
    h('div', { class: 'ann-label' }, ...richText(text)),
  );
}

/* ─── Block A: panel replica ───────────────────────────────────────── */

function renderBlockA(t: T): HTMLElement {
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'section-header' },
      h('h2', {}, t('welcome.step1.title')),
      h('p', {}, t('welcome.step1.body')),
    ),
    h(
      'div',
      { class: 'real-stage' },
      annotation('ann-clicks', t('welcome.ann.clicks')),
      annotation('ann-slider', t('welcome.ann.slider')),
      renderRealPanel(),
      annotation('ann-gear', t('welcome.ann.gear')),
    ),
  );
}

/** Replica of the real `.vs-panel` row — speed pills + slider + gear.
 *
 * Five pills only (1x, 1.5x, 2x, 2.5x, 3x with 2x active) so the panel
 * always fits on a single row even on narrow viewports — the absolute
 * positioning of annotations breaks if pills wrap.
 */
function renderRealPanel(): HTMLElement {
  const presets = ['1x', '1.5x', '2x', '2.5x', '3x'];
  const ACTIVE = '2x';

  const pills = presets.map((label) =>
    h(
      'button',
      {
        class: label === ACTIVE ? 'real-pill active' : 'real-pill',
        tabindex: -1,
        'data-ann-group': 'clicks',
      },
      label,
    ),
  );

  const slider = h('input', {
    type: 'range',
    class: 'real-slider',
    min: 0.75,
    max: 10,
    step: 0.05,
    value: 2,
    tabindex: -1,
    'aria-hidden': true,
  });

  const sliderWrap = h('div', { class: 'real-slider-wrap', 'data-ann-group': 'slider' }, slider);

  const gear = h(
    'button',
    { class: 'real-gear', 'aria-label': 'Settings', tabindex: -1, 'data-ann-group': 'gear' },
    vsFilledGearIcon(16),
  );

  return h('div', { class: 'real-panel' }, ...pills, sliderWrap, gear);
}

/* ─── Block B: settings replica ────────────────────────────────────── */

function renderBlockB(t: T): HTMLElement {
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'section-header' },
      h('h2', {}, t('welcome.step2.title')),
      h('p', {}, t('welcome.step2.body')),
    ),
    h(
      'div',
      { class: 'real-stage-settings' },
      renderRealSettings(t),
      h(
        'div',
        { class: 'settings-anns' },
        annotation('ann-help', t('welcome.ann.help')),
        annotation('ann-tabs', t('welcome.ann.tabs')),
        annotation('ann-presets', t('welcome.ann.presets')),
      ),
    ),
  );
}

function renderRealSettings(t: T): HTMLElement {
  const gearMini = vsFilledGearIcon(16);
  gearMini.classList.add('gear-mini');

  const helpIcon = vsIcon('help-circle', 18);
  helpIcon.classList.add('rs-header-help');
  helpIcon.dataset.annGroup = 'help';

  const tab = (icon: SVGElement, label: string, active = false): HTMLElement =>
    h('button', { class: active ? 'rs-tab active' : 'rs-tab', tabindex: -1 }, icon, label);

  const heart = vsIcon('heart', 13);
  heart.style.color = '#ff6e87';

  const tabs = h(
    'div',
    { class: 'rs-tabs', 'data-ann-group': 'tabs' },
    tab(vsIcon('sliders', 13), t('tabs.general'), true),
    tab(vsIcon('keyboard', 13), t('tabs.shortcuts')),
    tab(vsIcon('wrench', 13), t('tabs.diag')),
    tab(heart, t('tabs.donate')),
  );

  const segmented = h(
    'div',
    { class: 'rs-segmented' },
    h('button', { class: 'rs-seg-opt active', tabindex: -1 }, t('general.pos.right')),
    h('button', { class: 'rs-seg-opt', tabindex: -1 }, t('general.pos.bottom')),
    h('button', { class: 'rs-seg-opt', tabindex: -1 }, t('general.pos.video')),
  );

  // Mock preset grid — 7 representative values with a realistic on/off
  // mix. Less crowded than the full SPEED_POOL while still demonstrating
  // "tap to toggle". Intentional spread so user sees both ends of the
  // 0.75x–4x range.
  const PRESETS: Array<[string, boolean]> = [
    ['0.75x', false],
    ['1x', false],
    ['1.5x', true],
    ['2x', true],
    ['2.5x', true],
    ['3x', true],
    ['4x', false],
  ];
  const presetGrid = h(
    'div',
    { class: 'rs-preset-grid' },
    ...PRESETS.map(([label, on]) =>
      h('span', { class: on ? 'rs-preset-pill active' : 'rs-preset-pill' }, label),
    ),
  );

  const customRow = h(
    'div',
    { class: 'rs-custom-row' },
    h('input', {
      type: 'text',
      class: 'rs-custom-input',
      placeholder: t('general.speed_presets.custom_placeholder'),
      tabindex: -1,
      readonly: '',
    }),
    h(
      'button',
      { class: 'rs-custom-add', tabindex: -1 },
      `+ ${t('general.speed_presets.custom_add')}`,
    ),
  );

  return h(
    'div',
    { class: 'real-settings' },
    h(
      'div',
      { class: 'rs-header' },
      gearMini,
      h('span', { class: 'rs-header-title' }, t('menu.title')),
      helpIcon,
      h('span', { class: 'rs-header-version' }, `v${SCRIPT_VERSION}`),
    ),
    tabs,
    h(
      'div',
      { class: 'rs-panel' },
      h('div', { class: 'rs-section-label' }, t('general.slider_pos')),
      segmented,
      h(
        'div',
        { class: 'rs-preset-section', 'data-ann-group': 'presets' },
        h('div', { class: 'rs-section-label' }, t('general.speed_presets')),
        h('p', { class: 'rs-help-text' }, t('general.speed_presets.hint')),
        presetGrid,
        customRow,
        h('div', { class: 'rs-reset-link' }, t('general.speed_presets.reset')),
      ),
    ),
  );
}

/* ─── Hotkeys editor (live capture + step) ────────────────────────── *
 *
 * Replaces the static "Ctrl+C / Ctrl+V" demo with an editable surface.
 * Each capture input listens for the next keystroke after focus and
 * persists the new combo to chrome.storage for both YouTube and RuTube
 * sites in one go (welcome page doesn't have a "current site" — it
 * propagates the user's hotkey choice to every site the extension
 * runs on, mirroring the userscript's single-set-of-keys model).
 */

function renderHotkeys(
  t: T,
  initial: Settings,
  applyPatch: (patch: { hotkeys?: Settings['hotkeys']; speedStep?: number }) => Promise<void>,
): HTMLElement {
  // Local state mirrors what's persisted; UI reads/writes these.
  const liveHotkeys: Settings['hotkeys'] = {
    speedUp: [...initial.hotkeys.speedUp],
    speedDown: [...initial.hotkeys.speedDown],
  };
  let liveStep = initial.speedStep;

  // ----- Capture input — records the next keystroke into slot[0] -----
  function captureInput(
    action: 'speedUp' | 'speedDown',
    savedBadge: HTMLElement,
  ): HTMLInputElement {
    const slot0 = liveHotkeys[action][0] ?? {
      ctrl: false,
      shift: false,
      alt: false,
      meta: false,
      key: '',
    };
    const input = h('input', {
      type: 'text',
      class: 'hk-capture',
      value: slot0.key ? formatHotkey(slot0) : '',
      readonly: '',
      placeholder: t('welcome.hotkeys.placeholder'),
      'aria-label':
        action === 'speedUp' ? t('welcome.hotkeys.faster') : t('welcome.hotkeys.slower'),
    }) as HTMLInputElement;

    let armed = false;
    input.addEventListener('focus', () => {
      armed = true;
      input.value = '';
    });
    input.addEventListener('blur', () => {
      armed = false;
      const cur = liveHotkeys[action][0];
      if (cur?.key) input.value = formatHotkey(cur);
    });
    input.addEventListener('keydown', (event) => {
      if (!armed) return;
      const ev = event as KeyboardEvent;
      // Ignore bare modifier presses — wait for an actual key.
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(ev.key)) return;
      // Esc / Tab: leave field without changing.
      if (ev.key === 'Escape' || ev.key === 'Tab') {
        const cur = liveHotkeys[action][0];
        if (cur?.key) input.value = formatHotkey(cur);
        input.blur();
        return;
      }
      ev.preventDefault();
      ev.stopPropagation();
      const hk = captureHotkey(ev);
      // Replace primary slot only — second slot (HTPC remote fallback)
      // stays untouched so the welcome editor doesn't silently nuke it.
      const second = liveHotkeys[action][1];
      liveHotkeys[action] = second ? [hk, second] : [hk];
      input.value = formatHotkey(hk);
      void applyPatch({ hotkeys: liveHotkeys }).then(() => flashSaved(savedBadge));
      input.blur();
    });
    return input;
  }

  // ----- Step input — free-form number 0.01..1.0 -----
  function stepInput(savedBadge: HTMLElement): HTMLInputElement {
    const input = h('input', {
      type: 'number',
      class: 'hk-step',
      value: String(liveStep),
      min: 0.01,
      max: 1,
      step: 0.05,
      'aria-label': t('welcome.hotkeys.step_label'),
    }) as HTMLInputElement;

    input.addEventListener('change', () => {
      const v = parseFloat(input.value);
      if (Number.isFinite(v) && v >= 0.01 && v <= 1) {
        liveStep = Math.round(v * 100) / 100;
        input.value = String(liveStep);
        void applyPatch({ speedStep: liveStep }).then(() => flashSaved(savedBadge));
      } else {
        input.value = String(liveStep);
      }
    });
    return input;
  }

  function flashSaved(badge: HTMLElement): void {
    badge.classList.add('hk-saved-visible');
    window.setTimeout(() => badge.classList.remove('hk-saved-visible'), 1200);
  }

  const savedUp = h(
    'span',
    { class: 'hk-saved', 'aria-live': 'polite' },
    t('welcome.hotkeys.saved'),
  );
  const savedDown = h(
    'span',
    { class: 'hk-saved', 'aria-live': 'polite' },
    t('welcome.hotkeys.saved'),
  );
  const savedStep = h(
    'span',
    { class: 'hk-saved', 'aria-live': 'polite' },
    t('welcome.hotkeys.saved'),
  );

  return h(
    'div',
    { class: 'hotkeys-section' },
    h(
      'div',
      { class: 'section-header' },
      h('h2', {}, t('welcome.hotkeys.title')),
      h('p', {}, t('welcome.hotkeys.body')),
    ),
    h(
      'div',
      { class: 'hotkeys-card' },
      h(
        'div',
        { class: 'hk-row' },
        h('label', { class: 'hk-label' }, t('welcome.hotkeys.faster')),
        captureInput('speedUp', savedUp),
        savedUp,
      ),
      h(
        'div',
        { class: 'hk-row' },
        h('label', { class: 'hk-label' }, t('welcome.hotkeys.slower')),
        captureInput('speedDown', savedDown),
        savedDown,
      ),
      h(
        'div',
        { class: 'hk-row hk-step-row' },
        h('label', { class: 'hk-label' }, t('welcome.hotkeys.step_label')),
        stepInput(savedStep),
        h('span', { class: 'hk-unit' }, 'x'),
        savedStep,
      ),
      h('p', { class: 'hk-rebind' }, t('welcome.hotkeys.step_help')),
      h('p', { class: 'hk-more' }, t('welcome.hotkeys.more')),
    ),
  );
}

/* ─── Tips footer (re-open + pin) ──────────────────────────────────── */

function renderTips(t: T): HTMLElement {
  const reopenIcon = svgEl(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      width: 16,
      height: 16,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    },
    svgEl('polyline', { points: '1 4 1 10 7 10' }),
    svgEl('path', { d: 'M3.51 15a9 9 0 1 0 2.13-9.36L1 10' }),
  );
  reopenIcon.classList.add('tip-icon');

  const pinSvg = pinIcon();
  pinSvg.classList.add('tip-icon');
  pinSvg.setAttribute('aria-hidden', 'true');

  const tipRow = (icon: SVGElement, text: string): HTMLElement =>
    h('div', { class: 'tip-row' }, icon, h('span', {}, ...richText(text)));

  return h(
    'div',
    { class: 'tips-block' },
    tipRow(reopenIcon, t('welcome.tips.reopen')),
    tipRow(pinSvg, t('welcome.pin.tip')),
  );
}

/* ─── Donate ───────────────────────────────────────────────────────── */

function renderDonate(t: T): HTMLElement {
  const heart = vsIcon('heart', 36);
  heart.classList.add('welcome-donate-heart');

  const cloudtipsLink = h(
    'a',
    {
      class: 'welcome-donate-link',
      href: 'https://pay.cloudtips.ru/p/9b14d4f1',
      target: '_blank',
      rel: 'noopener noreferrer',
    },
    t('welcome.donate.cloudtips'),
  );

  const moreBtn = h(
    'button',
    { type: 'button', class: 'welcome-donate-link' },
    t('welcome.donate.more'),
  );

  // Inline fallback: clicking the crypto button reveals a tip pointing
  // users at the popup donate tab. Avoids duplicating the address-list UI
  // here while still routing them to a working flow.
  const moreTip = h('div', { class: 'welcome-donate-tip' }, t('welcome.donate.more.tip'));
  moreTip.style.display = 'none';
  moreBtn.addEventListener('click', () => {
    moreTip.style.display = 'block';
  });

  return h(
    'div',
    { class: 'welcome-donate' },
    heart,
    h('h3', {}, t('welcome.donate.title')),
    h('p', {}, t('welcome.donate.body')),
    h('div', { class: 'welcome-donate-actions' }, cloudtipsLink, moreBtn),
    moreTip,
  );
}

/* ─── CTA row ──────────────────────────────────────────────────────── */

function renderCta(t: T): HTMLElement {
  const hdrBtn = h(
    'a',
    {
      class: 'welcome-cta cta-hdr',
      href: 'https://rezka.ag/',
      target: '_blank',
      rel: 'noopener noreferrer',
    },
    t('welcome.cta.hdrezka'),
  );

  const closeBtn = h(
    'button',
    { type: 'button', class: 'welcome-cta cta-secondary' },
    t('welcome.cta.gotit'),
  );
  closeBtn.addEventListener('click', () => {
    // window.close() works because the welcome tab was opened by the
    // extension itself (browser.tabs.create in background.ts).
    window.close();
  });

  return h('div', { class: 'welcome-cta-row' }, hdrBtn, closeBtn);
}

/* ─── Helpers ──────────────────────────────────────────────────────── */

/**
 * Tiny markup parser for i18n strings: `**word**` -> `<strong>word</strong>`,
 * `\n` -> `<br>`. Everything else passes through as a text node. Keeps
 * translation strings plain-text (per i18n.spec.ts) while still allowing
 * inline emphasis on annotation labels.
 */
function richText(text: string): HChild[] {
  const out: HChild[] = [];
  const lines = text.split('\n');
  lines.forEach((line, lineIdx) => {
    if (lineIdx > 0) out.push(h('br'));
    const parts = line.split(/(\*\*[^*]+\*\*)/);
    for (const part of parts) {
      if (!part) continue;
      if (part.startsWith('**') && part.endsWith('**')) {
        out.push(h('strong', {}, part.slice(2, -2)));
      } else {
        out.push(part);
      }
    }
  });
  return out;
}

function pinIcon(): SVGElement {
  return svgEl(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      width: 16,
      height: 16,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    },
    svgEl('line', { x1: 12, y1: 17, x2: 12, y2: 22 }),
    svgEl('path', {
      d: 'M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1V4H8v2h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17z',
    }),
  );
}
