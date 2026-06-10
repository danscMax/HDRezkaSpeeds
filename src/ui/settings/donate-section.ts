/**
 * Donate tab content — three options:
 *   - CloudTips link (Russian cards, opens in a new tab)
 *   - Toncoin TON: expand inline panel with wallet link + address + Copy
 *   - USDT TRC20: same shape as TON
 *
 * UX deliberately compact (audit feedback 2026-04-28):
 *   The first iteration crammed numbered steps + a "Это всё, спасибо!"
 *   footer into the Diagnostics tab. That was wrong on two counts: nobody
 *   looks for monetisation under "Diagnostics", and the verbose
 *   instructional copy felt aggressive. The redesign moves the section
 *   into its own dedicated tab and trims each crypto entry to:
 *     - a one-line latency/fee descriptor under the toggle,
 *     - a single line "Wallet: Tonkeeper" link,
 *     - the address in a monospace box with an icon-only Copy button.
 *
 * Click handlers attach at element-creation time. The settings modal
 * `replaceChildren`s the rendered DOM on every rerender, so old buttons
 * + listeners are dropped atomically — no leak, no CleanupRegistry hookup.
 */

import type { Translator } from '../../app/ports';
import { h } from '../dom-h';
import { vsIcon } from '../icons';
import { showNotification } from '../notifications';

const CLOUDTIPS_URL = 'https://pay.cloudtips.ru/p/9b14d4f1';

interface CryptoMethod {
  /** i18n key suffix — `donate.<key>` and `donate.<key>.description`. */
  key: 'ton' | 'usdt';
  walletNameKey: string;
  walletUrl: string;
  address: string;
}

const TON: CryptoMethod = {
  key: 'ton',
  walletNameKey: 'donate.ton.wallet_name',
  walletUrl: 'https://tonkeeper.com/',
  address: 'UQBMEMUpZZmrnnZoFseXuewWD1RkyVYw5EuBqTAOIl-AuOgM',
};

const USDT_TRC20: CryptoMethod = {
  key: 'usdt',
  walletNameKey: 'donate.usdt.wallet_name',
  walletUrl: 'https://trustwallet.com/',
  address: 'TLuHigjqe8gjwfidfi2F7SZ4z27e4uShS6',
};

async function copyToClipboard(text: string, i18n: Translator): Promise<void> {
  // Audit 2026-05-09 M4: Firefox MV3 + some Edge builds reject
  // navigator.clipboard.writeText() in content-script context unless
  // a recent user gesture is in scope (and even then, the
  // dom.events.asyncClipboard.writeText pref can disable it). Fall
  // back to the legacy execCommand path via a hidden textarea — that
  // path works in every browser back to Chrome 43 / Firefox 41.
  if (await tryAsyncClipboard(text)) {
    showNotification(i18n.t('toast.address_copied'), {
      kind: 'success',
      playerContainer: null,
    });
    return;
  }
  if (tryExecCommandClipboard(text)) {
    showNotification(i18n.t('toast.address_copied'), {
      kind: 'success',
      playerContainer: null,
    });
    return;
  }
  showNotification(i18n.t('toast.copy_failed'), {
    kind: 'error',
    playerContainer: null,
  });
}

async function tryAsyncClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to execCommand */
  }
  return false;
}

function tryExecCommandClipboard(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    // Hide visually but keep selectable. position:fixed avoids the
    // page scrolling to the textarea, which a tall absolute element
    // would otherwise trigger.
    ta.style.cssText =
      'position:fixed; top:0; left:0; width:1px; height:1px; opacity:0; padding:0; border:0; margin:0;';
    ta.setAttribute('readonly', '');
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Build a crypto method block: toggle row (label · short description ·
 * chevron) + an initially-collapsed detail panel underneath with the
 * recommended-wallet link, the address, and a Copy button.
 */
function buildCryptoMethod(method: CryptoMethod, i18n: Translator): HTMLElement {
  const t = i18n.t;
  const labelKey = `donate.${method.key}`;
  const descKey = `donate.${method.key}.description`;
  const tipKey = `donate.${method.key}.tip`;

  const chevron = vsIcon('chevron-down', 12);
  chevron.classList.add('vs-donate-chevron');

  const toggleBtn = h(
    'button',
    {
      type: 'button',
      class: 'vs-donate-toggle',
      'aria-expanded': 'false',
      title: t(tipKey),
    },
    h(
      'span',
      { class: 'vs-donate-stack' },
      h('span', { class: 'vs-donate-label' }, t(labelKey)),
      h('span', { class: 'vs-donate-desc' }, t(descKey)),
    ),
    chevron,
  );

  const copyBtn = h(
    'button',
    {
      type: 'button',
      class: 'vs-donate-copy-btn',
      title: t('donate.crypto.copy'),
      'aria-label': t('donate.crypto.copy'),
    },
    vsIcon('clipboard', 14),
  );
  copyBtn.addEventListener('click', () => {
    void copyToClipboard(method.address, i18n);
  });

  const detail = h(
    'div',
    { class: 'vs-donate-detail', 'aria-hidden': 'true' },
    // Step 1: install a wallet (with link).
    h('div', { class: 'vs-donate-step' }, t('donate.crypto.step1')),
    h(
      'a',
      {
        href: method.walletUrl,
        target: '_blank',
        rel: 'noopener noreferrer',
        class: 'vs-donate-wallet-link',
      },
      t(method.walletNameKey),
      ' ',
      vsIcon('external-link', 11),
    ),
    // Step 2: copy the address (with monospace + Copy button).
    h('div', { class: 'vs-donate-step' }, t('donate.crypto.step2')),
    h(
      'div',
      { class: 'vs-donate-address-row' },
      h(
        'code',
        {
          class: 'vs-donate-address',
          'aria-label': t('donate.crypto.address_label'),
        },
        method.address,
      ),
      copyBtn,
    ),
    // Step 3: send from the wallet (plain instructions).
    h('div', { class: 'vs-donate-step vs-donate-step-final' }, t('donate.crypto.step3')),
  );

  toggleBtn.addEventListener('click', () => {
    const isOpen = detail.classList.toggle('show');
    toggleBtn.setAttribute('aria-expanded', String(isOpen));
    detail.setAttribute('aria-hidden', String(!isOpen));
  });

  return h('div', { class: 'vs-donate-method' }, toggleBtn, detail);
}

/**
 * Render the contents of the Support tab — intro line + CloudTips link +
 * the two crypto methods. Caller wraps this in the standard tab-panel
 * shell with `data-vs-panel="donate"`.
 */
export function renderDonateSection(i18n: Translator): HTMLElement {
  const t = i18n.t;

  const externalArrow = vsIcon('external-link', 12);
  externalArrow.classList.add('vs-donate-external');

  const cloudtipsBtn = h(
    'a',
    {
      class: 'vs-donate-cloudtips',
      href: CLOUDTIPS_URL,
      target: '_blank',
      rel: 'noopener noreferrer',
      title: t('donate.cloudtips.tip'),
    },
    h(
      'span',
      { class: 'vs-donate-stack' },
      h('span', { class: 'vs-donate-label' }, t('donate.cloudtips')),
      h('span', { class: 'vs-donate-desc' }, 'CloudTips'),
    ),
    externalArrow,
  );

  // Feedback link — same row visual style as the CloudTips button so
  // the Support tab reads as a coherent "ways to talk to / help the
  // author" group. Uses data-vs-diag="feedback" so the existing
  // handler in handlers.ts wires it up automatically.
  const feedbackBtn = h(
    'button',
    {
      type: 'button',
      class: 'vs-donate-cloudtips',
      'data-vs-diag': 'feedback',
      title: t('diag.btn.feedback.tip'),
    },
    h(
      'span',
      { class: 'vs-donate-stack' },
      h('span', { class: 'vs-donate-label' }, t('diag.btn.feedback')),
      h('span', { class: 'vs-donate-desc' }, t('feedback.intro')),
    ),
    vsIcon('mail', 14),
  );

  return h(
    'div',
    { class: 'vs-donate-content' },
    h('p', { class: 'vs-donate-intro' }, t('donate.thanks')),
    feedbackBtn,
    cloudtipsBtn,
    buildCryptoMethod(TON, i18n),
    buildCryptoMethod(USDT_TRC20, i18n),
  );
}
