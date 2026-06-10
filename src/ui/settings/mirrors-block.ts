/**
 * Mirrors tab content — user-defined HDRezka mirror domains.
 *
 * Pure render (no listeners — handlers.ts wires those via the
 * `data-vs-mirror-*` anchors). Built programmatically with `h()` like
 * every other settings block (no HTML strings reach a parser).
 *
 * Two surfaces share this block:
 *   - toolbar popup: full management — add (with permission prompt),
 *     re-grant, remove, "add current site" CTA, built-in status chips;
 *   - in-player gear menu: list add/remove only. Content scripts can't
 *     call `permissions.request`, so a no-access mirror shows a hint
 *     pointing at the toolbar icon instead of a grant button.
 */

import type { Translator } from '../../app/ports';
import { h } from '../dom-h';
import { vsIcon } from '../icons';

export interface MirrorsViewModel {
  builtinHosts: readonly string[];
  userHosts: readonly string[];
  /** host -> origin permission granted. `null` = unknown (in-player
   *  surface before the background status fetch lands). */
  status: Record<string, boolean> | null;
  /** Same map for built-ins. Firefox does not auto-grant host permissions
   *  added by an extension UPDATE (bug 1893232), so a built-in can be
   *  non-granted there; the popup offers the same re-grant button. */
  builtinStatus: Record<string, boolean> | null;
  /** True in the popup — `permissions.request` is reachable there. */
  canManagePermissions: boolean;
  /** Popup-only: the active tab's host, when readable and http(s). */
  currentHost?: {
    host: string;
    /** Show the "Add current site" CTA. */
    eligible: boolean;
    /** Host is already a granted mirror — offer a tab reload instead so
     *  the freshly-registered content script actually runs. */
    offerReload: boolean;
  };
  maxMirrors: number;
}

type BadgeState = 'active' | 'no-access' | 'unknown';

function badgeState(granted: boolean | undefined | null): BadgeState {
  if (granted === true) return 'active';
  if (granted === false) return 'no-access';
  return 'unknown';
}

function statusBadge(state: BadgeState, i18n: Translator): HTMLElement {
  const key =
    state === 'active'
      ? 'mirrors.badge.active'
      : state === 'no-access'
        ? 'mirrors.badge.no_access'
        : 'mirrors.badge.unknown';
  return h('span', {
    class: 'vs-mirror-status',
    'data-state': state,
    title: i18n.t(key),
    'aria-label': i18n.t(key),
  });
}

export function renderMirrorsBlock(vm: MirrorsViewModel, i18n: Translator): HTMLElement[] {
  const t = i18n.t;
  const out: HTMLElement[] = [];

  out.push(h('p', { class: 'vs-help-text' }, t('mirrors.help')));

  // Popup CTA row: either "reload the tab" (host already added + granted —
  // the content script loads on next navigation) or "add current site".
  if (vm.currentHost?.offerReload) {
    out.push(
      h(
        'button',
        { type: 'button', class: 'vs-action vs-mirror-cta', 'data-vs-mirror-reload': '' },
        vsIcon('refresh-cw', 14),
        ' ',
        t('mirrors.reload_tab'),
      ),
    );
  } else if (vm.currentHost?.eligible) {
    out.push(
      h(
        'button',
        {
          type: 'button',
          class: 'vs-action vs-mirror-cta',
          'data-vs-mirror-add-current': vm.currentHost.host,
          title: t('mirrors.add_current.tip'),
        },
        vsIcon('plus', 14),
        ' ',
        t('mirrors.add_current', { host: vm.currentHost.host }),
      ),
    );
  }

  // ----- User mirrors -----
  const atLimit = vm.userHosts.length >= vm.maxMirrors;
  const userRows = vm.userHosts.map((host) => {
    const state = badgeState(vm.status ? vm.status[host] : null);
    const rowChildren: (HTMLElement | string)[] = [
      statusBadge(state, i18n),
      h('span', { class: 'vs-mirror-host', title: host }, host),
    ];
    if (vm.canManagePermissions && state === 'no-access') {
      rowChildren.push(
        h(
          'button',
          {
            type: 'button',
            class: 'vs-mirror-grant',
            'data-vs-mirror-grant': host,
            title: t('mirrors.grant.tip'),
          },
          t('mirrors.grant'),
        ),
      );
    }
    rowChildren.push(
      h(
        'button',
        {
          type: 'button',
          class: 'vs-icon-button danger',
          'data-vs-mirror-remove': host,
          title: t('mirrors.remove.tip'),
          'aria-label': t('mirrors.remove.tip'),
        },
        vsIcon('x', 14),
      ),
    );
    return h('div', { class: 'vs-mirror-row', 'data-vs-mirror-host': host }, ...rowChildren);
  });

  const showPlayerGrantHint =
    !vm.canManagePermissions &&
    vm.status !== null &&
    vm.userHosts.some((host) => vm.status?.[host] === false);

  out.push(
    h(
      'div',
      { class: 'vs-section' },
      h(
        'div',
        { class: 'vs-section-label' },
        t('mirrors.user_section'),
        h(
          'span',
          { class: 'vs-mirror-count' },
          t('mirrors.count', { n: vm.userHosts.length, max: vm.maxMirrors }),
        ),
      ),
      vm.userHosts.length === 0
        ? h('p', { class: 'vs-help-text vs-mirror-empty' }, t('mirrors.empty'))
        : h('div', { class: 'vs-mirror-list' }, ...userRows),
      showPlayerGrantHint
        ? h('p', { class: 'vs-mirror-hint-warn' }, t('mirrors.player_grant_hint'))
        : null,
      h(
        'div',
        { class: 'vs-preset-custom-row' },
        h('input', {
          type: 'text',
          class: 'vs-preset-custom-input',
          'data-vs-mirror-input': '',
          placeholder: t('mirrors.input_placeholder'),
          'aria-label': t('mirrors.add.tip'),
          spellcheck: 'false',
          autocomplete: 'off',
          disabled: atLimit,
        }),
        h(
          'button',
          {
            type: 'button',
            class: 'vs-preset-custom-add',
            'data-vs-mirror-add': '',
            title: t('mirrors.add.tip'),
            disabled: atLimit,
          },
          '+ ',
          t('mirrors.add'),
        ),
      ),
    ),
  );

  // ----- Built-in mirrors (read-only chips; re-grant only in popup) -----
  const builtinChips = vm.builtinHosts.map((host) => {
    const state = badgeState(vm.builtinStatus ? vm.builtinStatus[host] : null);
    if (vm.canManagePermissions && state === 'no-access') {
      return h(
        'button',
        {
          type: 'button',
          class: 'vs-mirror-chip vs-mirror-chip-action',
          'data-vs-mirror-grant': host,
          'data-state': state,
          title: t('mirrors.grant.tip'),
        },
        statusBadge(state, i18n),
        host,
      );
    }
    return h(
      'span',
      { class: 'vs-mirror-chip', 'data-state': state },
      // In-player the badge is noise: built-ins are granted by definition
      // when the content script is running.
      vm.canManagePermissions ? statusBadge(state, i18n) : null,
      host,
    );
  });
  out.push(
    h(
      'div',
      { class: 'vs-section' },
      h('div', { class: 'vs-section-label' }, t('mirrors.builtin_section')),
      h('div', { class: 'vs-mirror-chips' }, ...builtinChips),
    ),
  );

  return out;
}
