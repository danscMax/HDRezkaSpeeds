/**
 * Settings modal builder — pure function from (settings, i18n, options) to a
 * `DocumentFragment` ready to be passed to `Element.replaceChildren()`.
 *
 * Three tabs: General, Shortcuts, Diagnostics. The active tab is preserved
 * across re-renders by passing `activeTab` from the parent state.
 *
 * Originally emitted an HTML string; rewritten 2026-04-28 to programmatic
 * DOM construction (audit follow-up to 0.1.34) so the bundled JS contains
 * no HTML-parsing API calls — that's what AMO's static analyzer flags
 * as "Unsafe call to ...".
 *
 * Ported from .user.js:4134-4311.
 */

import type { Site, Translator } from '../../app/ports';
import { SPEED_POOL, speedBoundsFor } from '../../config';
import type { Settings } from '../../storage/types';
import { fragment, type HChild, h } from '../dom-h';
import { vsIcon } from '../icons';
import { renderDonateSection } from './donate-section';
import { generateHotkeyBlock } from './hotkey-block';
import { type MirrorsViewModel, renderMirrorsBlock } from './mirrors-block';

/**
 * Resolve a URL inside the extension package. Prefers chrome.runtime
 * (Chromium MV3) but falls back to a sentinel string in test envs
 * where neither chrome nor browser globals exist.
 */
function extensionUrl(path: string): string {
  const c = (globalThis as unknown as { chrome?: { runtime?: { getURL?: (p: string) => string } } })
    .chrome;
  if (c?.runtime?.getURL) return c.runtime.getURL(path);
  const b = (
    globalThis as unknown as { browser?: { runtime?: { getURL?: (p: string) => string } } }
  ).browser;
  if (b?.runtime?.getURL) return b.runtime.getURL(path);
  return path;
}

export type ActiveTab = 'general' | 'hotkeys' | 'mirrors' | 'diag' | 'donate';

export interface ModalRenderOptions {
  settings: Settings;
  site: Site;
  i18n: Translator;
  activeTab: ActiveTab;
  scriptVersion: string;
  /** KillSwitch flags from Wave 1.9. Defaulting to true keeps render
   *  meaningful before the diagnostics layer wires in. */
  discoveryEnabled?: boolean;
  healthCheckEnabled?: boolean;
  /** User-mirrors view model. Absent = hide the Mirrors tab entirely
   *  (userscript build, where the extension permission/registration
   *  machinery doesn't exist). */
  mirrors?: MirrorsViewModel;
}

export type { MirrorsViewModel } from './mirrors-block';

/* -------------------------------------------------------------------------- */
/* Reusable section / row / toggle helpers                                    */
/* -------------------------------------------------------------------------- */

function vsSection(label: string, ...children: HChild[]): HTMLElement {
  return h(
    'div',
    { class: 'vs-section' },
    h('div', { class: 'vs-section-label' }, label),
    ...children,
  );
}

/** Standard label-on-left + control-on-right row (used for toggles). */
function vsRow(
  labelChildren: HChild | HChild[],
  control: HChild,
  rowAttrs: Record<string, string | number | boolean | undefined> = {},
): HTMLElement {
  const labelArr = Array.isArray(labelChildren) ? labelChildren : [labelChildren];
  return h(
    'label',
    { class: 'vs-row', ...rowAttrs },
    h('span', { class: 'vs-row-label' }, ...labelArr),
    control,
  );
}

/** iOS-style toggle: hidden checkbox + track + thumb. */
function vsToggle(name: string, checked: boolean): HTMLElement {
  return h(
    'span',
    { class: 'vs-toggle' },
    h('input', { type: 'checkbox', name, checked }),
    h('span', { class: 'vs-toggle-track' }),
    h('span', { class: 'vs-toggle-thumb' }),
  );
}

/** Segmented-control radio option. */
function vsSegmentedOption(
  attrs: Record<string, string | number | boolean | undefined>,
  ...children: HChild[]
): HTMLElement {
  return h('button', { class: 'vs-segmented-option', role: 'radio', ...attrs }, ...children);
}

/* -------------------------------------------------------------------------- */
/* Tab panels                                                                 */
/* -------------------------------------------------------------------------- */

function generalTab(opts: ModalRenderOptions, hidden: boolean): HTMLElement {
  const { settings, site, i18n } = opts;
  const t = i18n.t;
  const sel = (v: string): string => (v === settings.sliderPosition ? 'true' : 'false');

  const sliderPosSection = vsSection(
    t('general.slider_pos'),
    h(
      'div',
      { class: 'vs-segmented', role: 'radiogroup', 'aria-label': t('general.slider_pos') },
      vsSegmentedOption(
        { 'data-vs-pos': 'right', 'aria-pressed': sel('right'), title: t('general.pos.right.tip') },
        vsIcon('panel-right', 13),
        ' ',
        t('general.pos.right'),
      ),
      vsSegmentedOption(
        {
          'data-vs-pos': 'bottom',
          'aria-pressed': sel('bottom'),
          title: t('general.pos.bottom.tip'),
        },
        vsIcon('panel-bottom', 13),
        ' ',
        t('general.pos.bottom'),
      ),
      vsSegmentedOption(
        { 'data-vs-pos': 'video', 'aria-pressed': sel('video'), title: t('general.pos.video.tip') },
        vsIcon('tv', 13),
        ' ',
        t('general.pos.video'),
      ),
    ),
    // Audit 2026-05-10: visible only when the auto-collapse rule fires
    // (viewport narrow + sliderPosition='right'). See styles.ts.
    h('p', { class: 'vs-pos-hint-narrow' }, t('general.pos.narrow_hint')),
  );

  const presetSet = new Set<number>(settings.speedPresets ?? []);
  const bounds = speedBoundsFor(site);
  // The pool is the 14 conventional values; user-added custom speeds
  // (any 2-decimal number ≤10x) merge in via Settings.speedPresets.
  // Show every saved preset PLUS the pool entries within bounds, sorted.
  const visiblePool = SPEED_POOL.filter((s) => s >= bounds.min && s <= bounds.max);
  const visibleSet = new Set<number>([...visiblePool, ...presetSet]);
  const visibleSorted = Array.from(visibleSet).sort((a, b) => a - b);
  // v0.3.5 audit MAJ-11: split the flat 14-18 pill grid into three
  // ranges with subheaders. Casual users were overwhelmed by the wall;
  // grouping by speed range makes the choice scannable.
  const groups: { label: string; filter: (s: number) => boolean }[] = [
    { label: t('general.speed_presets.group.below'), filter: (s) => s < 1 },
    { label: t('general.speed_presets.group.normal'), filter: (s) => s >= 1 && s <= 2 },
    { label: t('general.speed_presets.group.above'), filter: (s) => s > 2 },
  ];
  const renderPill = (s: number): HTMLElement =>
    h(
      'button',
      {
        type: 'button',
        class: presetSet.has(s) ? 'vs-preset-pill active' : 'vs-preset-pill',
        'data-vs-preset': s,
        'aria-pressed': presetSet.has(s) ? 'true' : 'false',
      },
      formatPresetLabel(s),
    );
  const groupRows: HTMLElement[] = [];
  for (const g of groups) {
    const items = visibleSorted.filter(g.filter);
    if (items.length === 0) continue;
    groupRows.push(
      h(
        'div',
        { class: 'vs-preset-group' },
        h('div', { class: 'vs-preset-group-label' }, g.label),
        h('div', { class: 'vs-preset-grid' }, ...items.map(renderPill)),
      ),
    );
  }

  const presetSection = vsSection(
    t('general.speed_presets'),
    h('p', { class: 'vs-help-text' }, t('general.speed_presets.hint')),
    // UX-023: the click-vs-double-click semantics used to live only in
    // each button's hover tooltip — effectively invisible. One in-flow
    // line here makes the core gesture discoverable.
    h('p', { class: 'vs-help-text' }, t('general.speed_presets.dblclick_hint')),
    // FEAT-022: one-click preset profiles — a lightweight alternative to
    // hand-toggling pills for the common viewing modes.
    h(
      'div',
      { class: 'vs-preset-grid', style: 'margin-bottom: 8px;' },
      h(
        'button',
        {
          type: 'button',
          class: 'vs-preset-pill',
          'data-vs-preset-profile': 'movies',
          title: t('general.profile.movies.tip'),
        },
        t('general.profile.movies'),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'vs-preset-pill',
          'data-vs-preset-profile': 'lectures',
          title: t('general.profile.lectures.tip'),
        },
        t('general.profile.lectures'),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'vs-preset-pill',
          'data-vs-preset-profile': 'minimal',
          title: t('general.profile.minimal.tip'),
        },
        t('general.profile.minimal'),
      ),
    ),
    ...groupRows,
    h(
      'div',
      { class: 'vs-preset-custom-row' },
      h('input', {
        type: 'number',
        class: 'vs-preset-custom-input',
        'data-vs-preset-input': '',
        min: 0.5,
        max: 10,
        step: 0.05,
        placeholder: t('general.speed_presets.custom_placeholder'),
        'aria-label': t('general.speed_presets.custom_add.tip'),
      }),
      h(
        'button',
        {
          type: 'button',
          class: 'vs-preset-custom-add',
          'data-vs-preset-add': '',
          title: t('general.speed_presets.custom_add.tip'),
        },
        '+ ',
        t('general.speed_presets.custom_add'),
      ),
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'vs-reset-link',
        'data-vs-preset-reset': '',
      },
      t('general.speed_presets.reset'),
    ),
  );

  // Slider-range section: lets the user narrow or widen the range of the
  // in-player speed slider beyond the per-site defaults. Empty input ⇒
  // site default; the panel re-resolves on every settings change.
  const userMin = settings.sliderMin;
  const userMax = settings.sliderMax;
  const sliderRangeSection = vsSection(
    t('general.slider_range'),
    h('p', { class: 'vs-help-text' }, t('general.slider_range.hint')),
    h(
      'div',
      { class: 'vs-slider-range-row' },
      h(
        'label',
        { class: 'vs-slider-range-field' },
        h('span', { class: 'vs-slider-range-label' }, t('general.slider_range.min')),
        h('input', {
          type: 'number',
          class: 'vs-slider-range-input',
          'data-vs-slider-min': '',
          min: 0.05,
          max: bounds.max,
          step: 0.05,
          placeholder: String(bounds.min),
          value: typeof userMin === 'number' ? String(userMin) : '',
          'aria-label': t('general.slider_range.min'),
        }),
      ),
      h(
        'label',
        { class: 'vs-slider-range-field' },
        h('span', { class: 'vs-slider-range-label' }, t('general.slider_range.max')),
        h('input', {
          type: 'number',
          class: 'vs-slider-range-input',
          'data-vs-slider-max': '',
          min: 0.1,
          max: bounds.max,
          step: 0.05,
          placeholder: String(bounds.max),
          value: typeof userMax === 'number' ? String(userMax) : '',
          'aria-label': t('general.slider_range.max'),
        }),
      ),
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'vs-reset-link',
        'data-vs-slider-range-reset': '',
      },
      t('general.slider_range.reset'),
    ),
  );

  const langSection = vsSection(
    t('lang.section_label'),
    h(
      'div',
      { class: 'vs-segmented', role: 'radiogroup', 'aria-label': t('lang.section_label') },
      vsSegmentedOption(
        {
          'data-vs-lang': 'en',
          'aria-pressed': settings.language === 'en' ? 'true' : 'false',
          title: t('lang.tooltip_en'),
        },
        vsIcon('globe', 13),
        ' English',
      ),
      vsSegmentedOption(
        {
          'data-vs-lang': 'ru',
          'aria-pressed': settings.language === 'ru' ? 'true' : 'false',
          title: t('lang.tooltip_ru'),
        },
        vsIcon('globe', 13),
        ' Русский',
      ),
    ),
  );

  const behaviorSection = vsSection(
    t('behavior.section'),
    vsRow(t('behavior.remember'), vsToggle('remember-speed', !!settings.rememberSpeed), {
      title: t('behavior.remember.tip'),
    }),
    // FEAT-015: per-title memory (HDRezka id is stable across episodes).
    vsRow(
      t('behavior.remember_per_video'),
      vsToggle('remember-per-video', !!settings.rememberPerVideo),
      { title: t('behavior.remember_per_video.tip') },
    ),
    // UX-031: compact mode — collapse the panel to current speed + gear.
    vsRow(t('behavior.compact'), vsToggle('compact-mode', !!settings.compactMode), {
      title: t('behavior.compact.tip'),
    }),
    // FEAT-013: pitch preservation. Browsers default to true, so the
    // toggle reads as ON unless the user explicitly disabled it.
    vsRow(
      t('behavior.preserve_pitch'),
      vsToggle('preserve-pitch', settings.preservePitch !== false),
      { title: t('behavior.preserve_pitch.tip') },
    ),
  );

  // FEAT-017: volume boost (percent input, 100 = off). Deliberately a
  // separate section with an explicit warning hint — Web Audio boost
  // silences cross-origin media without CORS headers, so the user must
  // know how to back out.
  const boostPercent = Math.round((settings.volumeBoost ?? 1) * 100);
  const volumeSection = vsSection(
    t('behavior.volume_boost'),
    h(
      'div',
      { class: 'vs-preset-custom-row' },
      h('input', {
        type: 'number',
        class: 'vs-preset-custom-input',
        'data-vs-volume-boost': '',
        min: 100,
        max: 300,
        step: 10,
        value: String(boostPercent),
        'aria-label': t('behavior.volume_boost'),
      }),
      h('span', { class: 'vs-help-text', style: 'margin: 0;' }, '%'),
    ),
    h('p', { class: 'vs-help-text' }, t('behavior.volume_boost.tip')),
  );

  const advancedSection = vsSection(
    t('advanced.section'),
    vsRow(
      [
        t('advanced.discovery'),
        ' ',
        h('span', { class: 'vs-row-hint', title: t('advanced.discovery.hint') }, '?'),
      ],
      vsToggle('discovery-enabled', !!opts.discoveryEnabled),
    ),
    vsRow(
      [
        t('advanced.healthcheck'),
        ' ',
        h('span', { class: 'vs-row-hint', title: t('advanced.healthcheck.hint') }, '?'),
      ],
      vsToggle('healthcheck-enabled', !!opts.healthCheckEnabled),
    ),
  );

  return h(
    'div',
    {
      class: 'vs-tab-panel',
      'data-vs-panel': 'general',
      'aria-hidden': hidden ? 'true' : 'false',
    },
    sliderPosSection,
    presetSection,
    sliderRangeSection,
    langSection,
    behaviorSection,
    volumeSection,
    advancedSection,
    // Big "talk to the author" CTA at the bottom — same data-vs-diag
    // hook the Diagnostics tab uses, just styled larger so a regular
    // user finds it without diving into Diagnostics. Same handler in
    // handlers.ts opens feedback.html.
    h(
      'button',
      {
        type: 'button',
        class: 'vs-feedback-cta',
        'data-vs-diag': 'feedback',
        title: t('diag.btn.feedback.tip'),
      },
      vsIcon('mail', 16),
      ' ',
      t('diag.btn.feedback'),
    ),
  );
}

/** Mirror of the in-panel speed-button label rule: integers compact,
 *  fractions trim trailing zeros. Kept inline (1 line) — extracting
 *  to a shared helper would cross the storage/ui boundary needlessly. */
function formatPresetLabel(s: number): string {
  if (Number.isInteger(s)) return `${s}x`;
  return `${s.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}x`;
}

function hotkeysTab(opts: ModalRenderOptions, hidden: boolean): HTMLElement {
  const { settings, i18n } = opts;
  const t = i18n.t;
  return h(
    'div',
    {
      class: 'vs-tab-panel',
      'data-vs-panel': 'hotkeys',
      'aria-hidden': hidden ? 'true' : 'false',
    },
    h('p', { class: 'vs-help-text' }, t('hotkeys.help')),
    generateHotkeyBlock(
      'speedUp',
      settings.hotkeys.speedUp,
      t('hotkeys.speedup_label'),
      'chevron-up',
      i18n,
    ),
    generateHotkeyBlock(
      'speedDown',
      settings.hotkeys.speedDown,
      t('hotkeys.speeddown_label'),
      'chevron-down',
      i18n,
    ),
    // FEAT-018: the hotkey step lived only on the welcome page (which
    // most users skip) — surface it next to the hotkeys it modifies.
    vsSection(
      t('hotkeys.step'),
      h(
        'div',
        { class: 'vs-preset-custom-row' },
        h('input', {
          type: 'number',
          class: 'vs-preset-custom-input',
          'data-vs-speed-step': '',
          min: 0.01,
          max: 1,
          step: 0.01,
          value: String(settings.speedStep ?? 0.1),
          'aria-label': t('hotkeys.step'),
        }),
      ),
      h('p', { class: 'vs-help-text' }, t('hotkeys.step.hint')),
    ),
    // FEAT-011/012: quick actions.
    generateHotkeyBlock(
      'resetSpeed',
      settings.hotkeys.resetSpeed ?? [],
      t('hotkeys.reset_label'),
      'rotate-ccw',
      i18n,
    ),
    generateHotkeyBlock(
      'toggleLast',
      settings.hotkeys.toggleLast ?? [],
      t('hotkeys.toggle_label'),
      'refresh-cw',
      i18n,
    ),
    // FEAT-014: relative seek hotkeys + step.
    generateHotkeyBlock(
      'seekForward',
      settings.hotkeys.seekForward ?? [],
      t('hotkeys.seek_fwd_label'),
      'chevron-up',
      i18n,
    ),
    generateHotkeyBlock(
      'seekBack',
      settings.hotkeys.seekBack ?? [],
      t('hotkeys.seek_back_label'),
      'chevron-down',
      i18n,
    ),
    vsSection(
      t('hotkeys.seek_seconds'),
      h(
        'div',
        { class: 'vs-preset-custom-row' },
        h('input', {
          type: 'number',
          class: 'vs-preset-custom-input',
          'data-vs-seek-seconds': '',
          min: 1,
          max: 120,
          step: 1,
          value: String(settings.seekSeconds ?? 10),
          'aria-label': t('hotkeys.seek_seconds'),
        }),
      ),
    ),
  );
}

function mirrorsTab(opts: ModalRenderOptions, hidden: boolean): HTMLElement {
  return h(
    'div',
    {
      class: 'vs-tab-panel',
      'data-vs-panel': 'mirrors',
      'aria-hidden': hidden ? 'true' : 'false',
    },
    // Caller guarantees opts.mirrors when this tab is reachable (the tab
    // button itself renders only when the view model is present).
    ...(opts.mirrors ? renderMirrorsBlock(opts.mirrors, opts.i18n) : []),
  );
}

function diagTab(opts: ModalRenderOptions, hidden: boolean): HTMLElement {
  const { i18n } = opts;
  const t = i18n.t;
  return h(
    'div',
    {
      class: 'vs-tab-panel',
      'data-vs-panel': 'diag',
      'aria-hidden': hidden ? 'true' : 'false',
    },
    // UX-027: one plain-language line about what the check actually
    // verifies — without it "Run check" was a mystery button for
    // non-technical users.
    h('p', { class: 'vs-help-text' }, t('diag.explainer')),
    h(
      'div',
      {
        class: 'vs-status',
        'data-state': 'idle',
        'data-vs-diag-status': '',
        // Polite live region so screen readers announce status updates
        // (refreshDiagnosticStatus mutates the headline + detail children
        // when the watchdog or a manual recheck completes).
        'aria-live': 'polite',
        'aria-atomic': 'true',
      },
      h('div', { class: 'vs-status-dot' }),
      h(
        'div',
        { class: 'vs-status-body' },
        h(
          'div',
          { class: 'vs-status-headline', 'data-vs-diag-headline': '' },
          t('diag.status.not_checked'),
        ),
        h(
          'div',
          { class: 'vs-status-detail', 'data-vs-diag-detail': '' },
          t('diag.status.click_to_check'),
        ),
      ),
    ),
    h(
      'div',
      { class: 'vs-action-grid' },
      h(
        'button',
        { class: 'vs-action', 'data-vs-diag': 'recheck', title: t('diag.btn.recheck.tip') },
        vsIcon('refresh-cw', 14),
        ' ',
        t('diag.btn.recheck'),
      ),
      h(
        'button',
        { class: 'vs-action', 'data-vs-diag': 'copy', title: t('diag.btn.copy.tip') },
        vsIcon('clipboard', 14),
        ' ',
        t('diag.btn.copy'),
      ),
      h(
        'button',
        {
          class: 'vs-action danger',
          'data-vs-diag': 'purge-cache',
          title: t('diag.btn.purge.tip'),
        },
        vsIcon('trash', 14),
        ' ',
        t('diag.btn.purge'),
      ),
      h(
        'button',
        {
          class: 'vs-action danger',
          'data-vs-diag': 'full-reset',
          title: t('diag.btn.full_reset.tip'),
        },
        vsIcon('alert', 14),
        ' ',
        t('diag.btn.full_reset'),
      ),
      h(
        'button',
        {
          class: 'vs-action vs-action-feedback',
          'data-vs-diag': 'feedback',
          // UX-029: feedback opened from the Diagnostics tab pre-attaches
          // the diagnostic report on the feedback page (?attach=1).
          'data-vs-feedback-attach': '1',
          title: t('diag.btn.feedback.tip'),
        },
        vsIcon('mail', 14),
        ' ',
        t('diag.btn.feedback'),
      ),
    ),
    vsSection(
      t('settings.export'),
      h(
        'div',
        { class: 'vs-action-grid' },
        h(
          'button',
          { class: 'vs-action', 'data-vs-action': 'export', title: t('settings.export.tip') },
          vsIcon('clipboard', 14),
          ' ',
          t('settings.export'),
        ),
        h(
          'button',
          { class: 'vs-action', 'data-vs-action': 'import', title: t('settings.import.tip') },
          vsIcon('rotate-ccw', 14),
          ' ',
          t('settings.import'),
        ),
      ),
    ),
    h('div', { class: 'vs-privacy-hint' }, vsIcon('lock', 11), h('span', {}, t('diag.privacy'))),
  );
}

function donateTab(opts: ModalRenderOptions, hidden: boolean): HTMLElement {
  return h(
    'div',
    {
      class: 'vs-tab-panel vs-tab-panel-donate',
      'data-vs-panel': 'donate',
      'aria-hidden': hidden ? 'true' : 'false',
    },
    renderDonateSection(opts.i18n),
  );
}

/* -------------------------------------------------------------------------- */
/* Top-level                                                                  */
/* -------------------------------------------------------------------------- */

export function renderSettingsMenu(opts: ModalRenderOptions): DocumentFragment {
  const { i18n, scriptVersion } = opts;
  const t = i18n.t;
  // A persisted 'mirrors' tab with no view model (userscript build) falls
  // back to General instead of rendering an empty panel.
  const activeTab = opts.activeTab === 'mirrors' && !opts.mirrors ? 'general' : opts.activeTab;

  const helpIcon = vsIcon('help-circle', 14);
  helpIcon.classList.add('vs-menu-help-icon');
  const helpLink = h(
    'a',
    {
      class: 'vs-menu-help',
      href: extensionUrl('/welcome.html'),
      target: '_blank',
      rel: 'noopener noreferrer',
      title: t('menu.help.tip'),
      'aria-label': t('menu.help.tip'),
    },
    helpIcon,
  );

  // v0.3.5: version label removed from the header so the screenshot
  // doesn't go stale on every release. The same value is still
  // available in the diagnostic report (which the "Скопировать отчёт"
  // button generates) for support purposes.
  const header = h(
    'div',
    { class: 'vs-menu-header' },
    h('div', { class: 'vs-menu-title' }, vsIcon('settings', 14), ' ', t('menu.title')),
    // UX-030: Esc already closes the dialog, but nothing said so. A tiny
    // keycap badge in the header makes the affordance discoverable.
    h('span', { class: 'vs-menu-esc', title: t('menu.esc_hint'), 'aria-hidden': 'true' }, 'Esc'),
    helpLink,
  );
  void scriptVersion;

  const tabs = h(
    'div',
    { class: 'vs-tabs', role: 'tablist' },
    h(
      'button',
      {
        class: 'vs-tab',
        role: 'tab',
        'data-vs-tab': 'general',
        'aria-selected': activeTab === 'general' ? 'true' : 'false',
        title: t('tabs.general.tip'),
      },
      vsIcon('sliders', 13),
      ' ',
      t('tabs.general'),
    ),
    h(
      'button',
      {
        class: 'vs-tab',
        role: 'tab',
        'data-vs-tab': 'hotkeys',
        'aria-selected': activeTab === 'hotkeys' ? 'true' : 'false',
        title: t('tabs.shortcuts.tip'),
      },
      vsIcon('keyboard', 13),
      ' ',
      t('tabs.shortcuts'),
    ),
    opts.mirrors
      ? h(
          'button',
          {
            class: 'vs-tab',
            role: 'tab',
            'data-vs-tab': 'mirrors',
            'aria-selected': activeTab === 'mirrors' ? 'true' : 'false',
            title: t('tabs.mirrors.tip'),
          },
          vsIcon('globe', 13),
          ' ',
          t('tabs.mirrors'),
        )
      : null,
    h(
      'button',
      {
        class: 'vs-tab',
        role: 'tab',
        'data-vs-tab': 'diag',
        'aria-selected': activeTab === 'diag' ? 'true' : 'false',
        title: t('tabs.diag.tip'),
      },
      vsIcon('wrench', 13),
      ' ',
      t('tabs.diag'),
    ),
    h(
      'button',
      {
        class: 'vs-tab vs-tab-donate',
        role: 'tab',
        'data-vs-tab': 'donate',
        'aria-selected': activeTab === 'donate' ? 'true' : 'false',
        title: t('tabs.donate.tip'),
      },
      vsIcon('heart', 13),
      ' ',
      t('tabs.donate'),
    ),
  );

  // Audit 2026-05-10: wrap tab panels in a dedicated scroll container
  // (.vs-menu-body) so header + tabs stay pinned at the top regardless
  // of how tall the active tab grows.
  //
  // Audit 2026-05-11 W2.4 (PERF-001 + PERF-002): only render the
  // ACTIVE tab. Tab switch re-runs rerenderSettings() so this is a
  // pure cost reduction. attachSettingsHandlers' querySelectorAll
  // walks are now scoped to the single active panel automatically.
  const activePanel =
    activeTab === 'general'
      ? generalTab(opts, false)
      : activeTab === 'hotkeys'
        ? hotkeysTab(opts, false)
        : activeTab === 'mirrors'
          ? mirrorsTab(opts, false)
          : activeTab === 'diag'
            ? diagTab(opts, false)
            : donateTab(opts, false);
  const body = h('div', { class: 'vs-menu-body' }, activePanel);

  return fragment(header, tabs, body);
}
