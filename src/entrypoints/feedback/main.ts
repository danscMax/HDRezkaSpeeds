/**
 * Feedback page renderer. Opens in a new tab when the user clicks
 * "Send feedback" from the Diagnostics tab in the in-player gear menu.
 *
 * The page is a single self-contained form that POSTs to the
 * Cloudflare Worker (FEEDBACK_WORKER_URL in src/config.ts), which
 * forwards the message to the developer's Telegram inbox.
 *
 * Architecture mirrors welcome/main.ts: built programmatically with
 * the dom-h helpers, no innerHTML, no third-party UI library.
 */

import { browser } from 'wxt/browser';
import { h } from '../../ui/dom-h';
import { vsIcon } from '../../ui/icons';
import { detectBrowserLang } from '../../i18n/detect';
import { createTranslator } from '../../i18n/translator';
import type { Translator } from '../../app/ports';
import { createBrowserStorageAdapter } from '../../storage/adapter';
import {
  storageKeysFor,
  FEEDBACK_WORKER_URL,
  FALLBACK_CONTACT_EMAIL,
  FEEDBACK_APP_ID,
} from '../../config';
import type { Settings } from '../../storage/types';
import type { Lang } from '../../i18n/dict';

declare const __VS_VERSION__: string | undefined;
const SCRIPT_VERSION =
  typeof __VS_VERSION__ === 'string' ? __VS_VERSION__ : '0.1.0';

type Rating = 'positive' | 'neutral' | 'negative';

interface FormState {
  rating: Rating;
  message: string;
  contact: string;
  attachDiagnostics: boolean;
}

const root = document.getElementById('feedback-app');
if (root) void bootstrap(root);

async function bootstrap(host: HTMLElement): Promise<void> {
  // Honour the user's persisted language preference if it exists; fall
  // back to browser language detection. Reading both site keys is fine
  // here — feedback is global to the extension.
  const adapter = createBrowserStorageAdapter();
  const stored = await adapter.get<Partial<Settings> | null>(
    storageKeysFor(FEEDBACK_APP_ID as 'hdrezka').settings,
    null,
  );
  const lang: Lang =
    stored?.language === 'ru' || stored?.language === 'en'
      ? (stored.language as Lang)
      : detectBrowserLang();
  document.documentElement.lang = lang;

  // Adopt the persisted theme so the form matches whatever the user
  // last saw on the host page.
  const theme = stored?.lastSeenTheme;
  document.documentElement.dataset.vsTheme =
    theme === 'light' || theme === 'dark' ? theme : 'dark';

  const translator = createTranslator(lang);
  document.title = translator.t('feedback.title');

  renderForm(host, translator);
}

function renderForm(host: HTMLElement, t: Translator): void {
  const state: FormState = {
    rating: 'neutral',
    message: '',
    contact: '',
    // Off by default — the diagnostic blob carries enough fingerprint
    // bits (settings, browser, viewport, language) that we don't want
    // it transmitted unless the user actively opts in (audit 0.2.8).
    attachDiagnostics: false,
  };

  const ratingBtn = (value: Rating, emoji: string, labelKey: string): HTMLButtonElement => {
    const btn = h(
      'button',
      {
        type: 'button',
        class: 'fb-rating-btn',
        'data-rating': value,
        'aria-pressed': state.rating === value ? 'true' : 'false',
      },
      h('span', { class: 'fb-rating-emoji' }, emoji),
      ' ',
      t.t(labelKey),
    ) as HTMLButtonElement;
    btn.addEventListener('click', () => {
      state.rating = value;
      for (const b of host.querySelectorAll<HTMLButtonElement>('.fb-rating-btn')) {
        b.setAttribute('aria-pressed', b.dataset.rating === value ? 'true' : 'false');
      }
    });
    return btn;
  };

  const messageEl = h('textarea', {
    class: 'fb-textarea',
    placeholder: t.t('feedback.message.placeholder'),
    maxlength: '4000',
  }) as HTMLTextAreaElement;
  messageEl.addEventListener('input', () => { state.message = messageEl.value; });

  const contactEl = h('input', {
    type: 'text',
    class: 'fb-input',
    placeholder: t.t('feedback.contact.placeholder'),
    maxlength: '200',
    autocomplete: 'off',
  }) as HTMLInputElement;
  contactEl.addEventListener('input', () => { state.contact = contactEl.value.trim(); });

  const diagCheckbox = h('input', {
    type: 'checkbox',
  }) as HTMLInputElement;
  diagCheckbox.addEventListener('change', () => {
    state.attachDiagnostics = diagCheckbox.checked;
  });

  const submitBtn = h(
    'button',
    { type: 'submit', class: 'fb-submit' },
    t.t('feedback.submit'),
  ) as HTMLButtonElement;

  const errorBox = h('div', { class: 'fb-error', hidden: 'true' }) as HTMLDivElement;

  const formEl = h(
    'form',
    { class: 'fb-form' },
    h(
      'div',
      { class: 'fb-section' },
      h('label', { class: 'fb-label' }, t.t('feedback.rating.label')),
      h(
        'div',
        { class: 'fb-rating', role: 'radiogroup' },
        ratingBtn('positive', '😊', 'feedback.rating.positive'),
        ratingBtn('neutral',  '😐', 'feedback.rating.neutral'),
        ratingBtn('negative', '😞', 'feedback.rating.negative'),
      ),
    ),
    h(
      'div',
      { class: 'fb-section' },
      h('label', { class: 'fb-label' }, t.t('feedback.message.label')),
      messageEl,
    ),
    h(
      'div',
      { class: 'fb-section' },
      h('label', { class: 'fb-label' }, t.t('feedback.contact.label')),
      contactEl,
      h('div', { class: 'fb-hint' }, t.t('feedback.contact.hint')),
    ),
    h(
      'div',
      { class: 'fb-section' },
      h(
        'label',
        { class: 'fb-checkbox-row' },
        diagCheckbox,
        h(
          'div',
          {},
          h('span', { class: 'fb-label' }, t.t('feedback.diag.label')),
          h('div', { class: 'fb-hint' }, t.t('feedback.diag.hint')),
        ),
      ),
    ),
    h(
      'div',
      { class: 'fb-privacy' },
      t.t('feedback.privacy'),
    ),
    h(
      'div',
      { class: 'fb-actions' },
      submitBtn,
      h(
        'div',
        { class: 'fb-mailto' },
        t.t('feedback.error.fallback', { email: '' }).replace('.', ''),
        ' ',
        h('a', { href: `mailto:${FALLBACK_CONTACT_EMAIL}` }, FALLBACK_CONTACT_EMAIL),
      ),
    ),
    errorBox,
  ) as HTMLFormElement;

  formEl.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!state.message.trim()) {
      messageEl.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = t.t('feedback.submitting');
    errorBox.hidden = true;
    errorBox.textContent = '';

    try {
      await submit(state);
      renderSuccess(host, t);
    } catch (e) {
      const code = e instanceof FeedbackError ? e.code : 'network';
      errorBox.hidden = false;
      errorBox.replaceChildren(
        h('strong', {}, t.t('feedback.error.title')),
        h('span', {}, t.t(errorMessageKey(code))),
        h('br'),
        h('br'),
        h('span', {}, t.t('feedback.error.fallback', { email: '' }).replace('.', '')),
        ' ',
        h('a', { href: `mailto:${FALLBACK_CONTACT_EMAIL}` }, FALLBACK_CONTACT_EMAIL),
      );
      submitBtn.disabled = false;
      submitBtn.textContent = t.t('feedback.retry');
    }
  });

  host.replaceChildren(
    h(
      'div',
      { class: 'fb-header' },
      h('div', { class: 'fb-icon' }, vsIcon('mail', 26)),
      h('h1', { class: 'fb-title' }, t.t('feedback.title')),
      h('p', { class: 'fb-intro' }, t.t('feedback.intro')),
    ),
    formEl,
  );
}

function renderSuccess(host: HTMLElement, t: Translator): void {
  const closeBtn = h(
    'button',
    { class: 'primary' },
    t.t('feedback.success.close'),
  ) as HTMLButtonElement;
  closeBtn.addEventListener('click', () => window.close());

  const againBtn = h(
    'button',
    {},
    t.t('feedback.success.again'),
  ) as HTMLButtonElement;
  againBtn.addEventListener('click', () => renderForm(host, t));

  host.replaceChildren(
    h(
      'div',
      { class: 'fb-form fb-success' },
      h(
        'div',
        { class: 'fb-success-icon' },
        vsIcon('check-circle', 32),
      ),
      h('h1', { class: 'fb-success-title' }, t.t('feedback.success.title')),
      h('p', { class: 'fb-success-body' }, t.t('feedback.success.body')),
      h(
        'div',
        { class: 'fb-success-actions' },
        closeBtn,
        againBtn,
      ),
    ),
  );
}

class FeedbackError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

async function submit(state: FormState): Promise<void> {
  const diagnostics = state.attachDiagnostics ? await collectDiagnostics() : undefined;

  const payload = {
    app: FEEDBACK_APP_ID,
    version: SCRIPT_VERSION,
    rating: state.rating,
    message: state.message,
    contact: state.contact || undefined,
    diagnostics,
    // userAgent removed in 0.2.8 — adds fingerprint surface and the
    // browser-version detection inside the diagnostic snapshot is
    // already enough for repro purposes when the user opts in.
  };

  let res: Response;
  try {
    res = await fetch(FEEDBACK_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      // Hard-cap at 15s so a stalled connection (Worker cold-start, transit
      // hang, Telegram outage upstream) doesn't leave the submit button in
      // a permanent "Sending…" state. AbortSignal.timeout has been Baseline
      // since 2023; fetch maps the abort to a TypeError -> catch -> network.
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new FeedbackError('network');
  }

  if (res.status === 429) throw new FeedbackError('rate_limit');
  if (res.status >= 400 && res.status < 500) throw new FeedbackError('validation');
  if (!res.ok) throw new FeedbackError('server');
}

function errorMessageKey(code: string): string {
  switch (code) {
    case 'rate_limit': return 'feedback.error.rate_limit';
    case 'validation': return 'feedback.error.validation';
    case 'server':     return 'feedback.error.server';
    default:           return 'feedback.error.network';
  }
}

/**
 * Collect a small, anonymous snapshot for the developer to reproduce
 * issues. This is a SUBSET of the full diagnostic report (which lives
 * in the content script's HealthChecker and isn't reachable from the
 * extension page); we keep it scoped to information that doesn't
 * require talking to the active tab.
 */
async function collectDiagnostics(): Promise<string> {
  const adapter = createBrowserStorageAdapter();
  const settings = await adapter.get<Partial<Settings> | null>(
    storageKeysFor(FEEDBACK_APP_ID as 'hdrezka').settings,
    null,
  );
  const speed = await adapter.get<unknown>(
    storageKeysFor(FEEDBACK_APP_ID as 'hdrezka').speed,
    null,
  );

  const snapshot = {
    extension: FEEDBACK_APP_ID,
    version: SCRIPT_VERSION,
    timestamp: new Date().toISOString(),
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio,
    },
    language: navigator.language,
    languages: navigator.languages,
    settings: settings ?? null,
    speed: speed ?? null,
    browser: detectBrowser(),
  };

  return JSON.stringify(snapshot, null, 2);
}

function detectBrowser(): string {
  const ua = navigator.userAgent;
  if (ua.includes('Firefox/')) {
    const m = /Firefox\/(\S+)/.exec(ua);
    return `Firefox ${m?.[1] ?? '?'}`;
  }
  if (ua.includes('Edg/')) {
    const m = /Edg\/(\S+)/.exec(ua);
    return `Edge ${m?.[1] ?? '?'}`;
  }
  if (ua.includes('Chrome/')) {
    const m = /Chrome\/(\S+)/.exec(ua);
    return `Chrome ${m?.[1] ?? '?'}`;
  }
  return ua;
}

void browser;
