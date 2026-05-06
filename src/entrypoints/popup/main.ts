/**
 * Popup entrypoint -- mirrors the in-player gear-menu so the user can
 * tweak settings without opening a video.
 *
 * Architecture:
 *   - Detect the active tab via browser.tabs.query (no broad `tabs`
 *     permission needed; URL access uses the activeTab grant from the
 *     toolbar click). Audit H9.
 *   - Build a popup-flavoured AppContext: real SettingsStore + SpeedStore
 *     reading the same browser.storage.local the content script writes,
 *     no UiPort/discovery (no video here), no panel.
 *   - Render the SAME settings modal template via renderSettingsMenu, but
 *     the diagnostics tab swaps in a "view diagnostics in the player"
 *     hint because there's no video / health-checker context here.
 *   - SettingsStore.subscribe() on storage.onChanged would be ideal; for
 *     now the popup mirrors content-script writes by re-init on focus.
 */

import { browser } from 'wxt/browser';
import { CleanupRegistry } from '../../app/cleanup';
import type { AppContext } from '../../app/context';
import { createBrowserStorageAdapter } from '../../storage/adapter';
import { createSettingsStore } from '../../storage/settings-store';
import { createSpeedStore } from '../../storage/speed-store';
import { detectSite } from '../../sites/detect';
import {
  attachSettingsHandlers,
  injectStyles,
  renderSettingsMenu,
  showNotification,
  type ActiveTab,
} from '../../ui';
import { h } from '../../ui/dom-h';
import { createTranslator } from '../../i18n/translator';
import { detectBrowserLang } from '../../i18n/detect';
import { createLogger } from '../../utils/logger';
import type {
  DiagnosticsPort,
  DiscoveryPort,
  Site,
  UiPort,
} from '../../app/ports';
import type { DiagnosticReport } from '../../health/types';

declare const __VS_VERSION__: string | undefined;
const SCRIPT_VERSION =
  typeof __VS_VERSION__ === 'string' ? __VS_VERSION__ : '0.1.0';

console.info('[HDREZKA-SPEEDS] popup loaded');

const root = document.getElementById('app');
if (root) {
  // Set a temporary dark theme on <html> so the synchronous skeleton
  // never flashes light before async storage read settles. The async
  // path below overrides with the persisted lastSeenTheme as soon as
  // it's available.
  document.documentElement.dataset.vsTheme = 'dark';
  renderInitialShell(root);
  void bootstrapPopup(root).catch((e) => {
    console.error('[HDREZKA-SPEEDS] popup bootstrap failed', e);
    root.replaceChildren(
      h(
        'div',
        { class: 'vs-popup-empty' },
        h('span', { class: 'vs-popup-empty-title' }, 'Failed to load'),
        ' ',
        String(e?.message ?? e),
      ),
    );
  });
}

/**
 * Synchronous skeleton — same outer shape as the final settings menu so
 * the popup window size is correct before any async work completes.
 * Translator hasn't loaded yet, so labels are language-neutral
 * placeholders that get replaced by the real menu in milliseconds.
 */
function renderInitialShell(host: HTMLElement): void {
  host.replaceChildren(
    h(
      'div',
      { class: 'settings-menu vs-popup-skeleton' },
      h(
        'div',
        { class: 'vs-skel-header' },
        h('div', { class: 'vs-skel-line vs-skel-w-60' }),
      ),
      h(
        'div',
        { class: 'vs-skel-tabs' },
        h('div', { class: 'vs-skel-pill' }),
        h('div', { class: 'vs-skel-pill' }),
        h('div', { class: 'vs-skel-pill' }),
        h('div', { class: 'vs-skel-pill' }),
      ),
      h(
        'div',
        { class: 'vs-skel-body' },
        h('div', { class: 'vs-skel-line vs-skel-w-40' }),
        h('div', { class: 'vs-skel-block' }),
        h('div', { class: 'vs-skel-line vs-skel-w-40' }),
        h('div', { class: 'vs-skel-block' }),
        h('div', { class: 'vs-skel-line vs-skel-w-40' }),
        h('div', { class: 'vs-skel-row' }),
        h('div', { class: 'vs-skel-row' }),
      ),
    ),
  );
}

async function bootstrapPopup(host: HTMLElement): Promise<void> {
  // 1. Detect which site the active tab is on. activeTab grant from the
  //    toolbar click gives us URL access for THIS click only.
  const detected = await detectActiveTabSite();
  if (!detected) {
    renderNoSitePlaceholder(host);
    return;
  }
  const site: Site = detected;

  // Tag <html> with the active-tab site so the cascading menu styles
  // (active pills, toggles, segmented control) use the per-site accent
  // — red on YouTube, blue on RuTube. Mirrors the in-player .vs-panel
  // [data-vs-site] approach. Without this attribute the popup falls back
  // to the YouTube-red default declared at :root.
  document.documentElement.dataset.vsSite = site;

  // 2. Build the popup-flavoured context.
  const adapter = createBrowserStorageAdapter();
  const settingsStore = createSettingsStore(adapter);
  const speedStore = createSpeedStore(adapter);
  await settingsStore.init(site);
  await speedStore.init(site);


  const logger = createLogger({ scriptName: 'HDREZKA-POPUP' });
  const cleanup = new CleanupRegistry();
  const i18n = createTranslator(settingsStore.getKey('language'));

  const ui: UiPort = {
    refreshButtons: () => {},
    refreshSlider: () => {},
    showNotification: (text, kind) =>
      showNotification(text, { kind, playerContainer: null }),
    applyLayout: () => {},
  };

  const discovery: DiscoveryPort = {
    hydrate: () => Promise.resolve(),
    resolve: () => null,
    invalidate: () => {},
    cacheStats: () => ({ hits: 0, misses: 0, ready: false }),
  };

  const diagnostics: DiagnosticsPort = {
    report: () => ({} as DiagnosticReport),
    isHealthy: () => true,
    killSwitchEngaged: () => false,
    trip: () => {},
  };

  const ctx: AppContext = {
    site,
    settingsStore,
    speedStore,
    ui,
    discovery,
    diagnostics,
    cleanup,
    logger,
    i18n,
  };

  // 3. Inject the in-player CSS (same selectors -- the popup-style.css
  //    overrides .settings-menu positioning so it fills the popup body
  //    instead of floating).
  injectStyles(site);

  // 3a. Override the OS-based theme guess with whatever the content
  //     script last persisted for this site. injectStyles() above ran
  //     detectAndApplyTheme() which falls back to prefers-color-scheme
  //     (popup has no host-page attributes); but on YouTube the user's
  //     in-page light/dark toggle is the only authoritative signal —
  //     we capture it in lastSeenTheme on the host page side.
  const persistedTheme = settingsStore.getKey('lastSeenTheme');
  if (persistedTheme === 'dark' || persistedTheme === 'light') {
    document.documentElement.dataset.vsTheme = persistedTheme;
  }

  // 4. Render. activeTab persists across re-renders.
  let activeTab: ActiveTab = 'general';
  function rerender(): void {
    const menu = h(
      'div',
      { class: 'settings-menu' },
      renderSettingsMenu({
        settings: settingsStore.get(),
        site,
        i18n: ctx.i18n,
        activeTab,
        scriptVersion: SCRIPT_VERSION,
        // KillSwitch flags are content-script-side; popup just shows them.
        discoveryEnabled: true,
        healthCheckEnabled: true,
      }),
    );
    // Show the "open the player to run diagnostics" hint only on the
     // Diagnostics tab — on General/Keys/Donate it has no context and just
     // looked like a leaked tooltip pinned to the popup bottom (audit
     // 0.2.0).
    const children: Node[] = [menu];
    if (activeTab === 'diag') {
      children.push(
        h(
          'div',
          { class: 'vs-popup-diag-hint' },
          ctx.i18n.t('diag.status.click_to_check'),
        ),
      );
    }
    host.replaceChildren(...children);
    attachSettingsHandlers(menu, ctx, {
      setActiveTab: (t) => { activeTab = t; },
      rerender,
      onDiag: () => {
        // Popup can't run live diagnostics; nudge user to in-player gear.
        ui.showNotification(
          ctx.i18n.t('diag.status.click_to_check'),
          'info',
        );
      },
    });
  }

  // Re-init translator on language switch. Subscriber fires on every
  // update; rebuilding the translator is cheap (~150 keys).
  cleanup.add(
    settingsStore.subscribe((next) => {
      ctx.i18n = createTranslator(next.language as 'en' | 'ru');
    }),
  );

  // 5. Listen for storage.onChanged so the popup reflects edits made in
  //    the in-player gear without needing a manual refresh.
  const storageListener = (changes: Record<string, unknown>): void => {
    if (changes['__vs_skip__']) return;
    rerender();
  };
  browser.storage.local.onChanged.addListener(storageListener);
  cleanup.add(() => browser.storage.local.onChanged.removeListener(storageListener));

  rerender();
}

async function detectActiveTabSite(): Promise<Site | null> {
  try {
    const ourPopupPrefix = browser.runtime.getURL('/popup.html');
    const matches = (t: { url?: string }): boolean => {
      if (!t.url || t.url.startsWith(ourPopupPrefix)) return false;
      try {
        return detectSite(new URL(t.url).hostname) !== null;
      } catch {
        return false;
      }
    };

    // Strategy ladder, in order of authority:
    //   1) The toolbar popup runs in `currentWindow` and resolves to the
    //      window that owns the toolbar button. {active:true, currentWindow:true}
    //      gives us THE tab the user was looking at when they clicked.
    //      Earlier we used `tabs.query({})` and `.find()` which matched
    //      any supported tab in any window — on a multi-window setup with
    //      both YouTube and RuTube open it locked onto whichever Chrome
    //      enumerated first (audit 0.2.0).
    //   2) `lastFocusedWindow:true` covers the dev-tab case (popup opened
    //      directly as `chrome-extension://<id>/popup.html` for testing).
    //   3) Last-resort fallback to any supported tab in any window — at
    //      least gives the user *some* settings rather than the empty-
    //      placeholder when both windows have the popup-as-page URL active.
    const queries = [
      { active: true, currentWindow: true },
      { active: true, lastFocusedWindow: true },
      {},
    ] as const;
    for (const q of queries) {
      const tabs = await browser.tabs.query(q);
      const hit = tabs.find(matches);
      if (hit?.url) return detectSite(new URL(hit.url).hostname);
    }
    return null;
  } catch {
    return null;
  }
}

function renderNoSitePlaceholder(host: HTMLElement): void {
  // Falls back to the user's browser language because we can't read settings
  // without knowing the site (settings are per-site).
  const lang = detectBrowserLang();
  const t = createTranslator(lang).t;
  const subline = lang === 'ru'
    ? 'Откройте HDRezka, чтобы открыть настройки.'
    : 'Open HDRezka to access settings.';
  host.replaceChildren(
    h(
      'div',
      { class: 'vs-popup-empty' },
      h('span', { class: 'vs-popup-empty-title' }, 'HDRezka Speed Controller'),
      ' ',
      t('tabs.general.tip'),
      h('div', { style: 'margin-top:12px;font-size:11px;opacity:0.55;' }, subline),
    ),
  );
}
