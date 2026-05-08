/**
 * Single-action hotkey block: label + N hotkey-input rows + add + reset.
 *
 * Used twice in the Settings modal (speedUp, speedDown). Returns an
 * HTMLElement built programmatically (audit follow-up to 0.1.34, no
 * HTML strings reach a parser).
 */

import type { Translator } from '../../app/ports';
import { formatHotkey } from '../../speed/hotkeys';
import type { Hotkey } from '../../storage/types';
import { h } from '../dom-h';
import { type IconName, vsIcon } from '../icons';

export type HotkeyAction = 'speedUp' | 'speedDown';

export function generateHotkeyBlock(
  action: HotkeyAction,
  hotkeys: readonly Hotkey[],
  label: string,
  iconName: IconName,
  i18n: Translator,
): HTMLElement {
  return h(
    'div',
    { class: 'vs-hotkey-block', 'data-hotkey-block': action },
    h(
      'div',
      { class: 'vs-hotkey-block-title' },
      h(
        'span',
        { style: 'display:inline-flex; align-items:center; gap:6px;' },
        vsIcon(iconName, 13),
        ' ',
        label,
      ),
    ),
    h(
      'div',
      { class: 'vs-hotkey-list' },
      ...hotkeys.map((hk, i) =>
        h(
          'div',
          {
            class: 'vs-hotkey-row',
            'data-hotkey-type': action,
            'data-slot-index': i,
          },
          h('input', {
            type: 'text',
            class: 'vs-hotkey-input',
            placeholder: i18n.t('hotkeys.placeholder'),
            // Empty-key placeholder slots render with no value so the
            // input's `placeholder` attribute shows the hint text. Mirror
            // .user.js add-slot behaviour where the new row reads as a
            // capture prompt until filled.
            value: hk.key ? formatHotkey(hk) : '',
            tabindex: 0,
            readonly: true,
            title: i18n.t('hotkeys.input.tip'),
          }),
          h(
            'button',
            {
              type: 'button',
              class: 'vs-icon-button danger',
              'data-vs-hotkey-remove': '',
              title: i18n.t('hotkeys.remove.tip'),
            },
            vsIcon('x', 14),
          ),
        ),
      ),
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'vs-add-button',
        'data-vs-hotkey-add': action,
        title: i18n.t('hotkeys.add.tip'),
      },
      vsIcon('plus', 14),
      ' ',
      i18n.t('hotkeys.add'),
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'vs-reset-link',
        'data-vs-hotkey-reset': action,
        title: i18n.t('hotkeys.reset.tip'),
      },
      i18n.t('hotkeys.reset'),
    ),
  );
}
