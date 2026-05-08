import { describe, expect, it } from 'vitest';
import {
  captureHotkey,
  formatHotkey,
  matchesHotkeyArray,
  matchesSingleHotkey,
  normalizeKeyName,
} from '../../src/speed/hotkeys';
import type { Hotkey } from '../../src/storage/types';

function makeEvent(overrides: Partial<KeyboardEventInit> & { code: string }): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    code: overrides.code,
    ctrlKey: overrides.ctrlKey ?? false,
    shiftKey: overrides.shiftKey ?? false,
    altKey: overrides.altKey ?? false,
    metaKey: overrides.metaKey ?? false,
  });
}

describe('normalizeKeyName', () => {
  it('strips Key prefix for letters', () => {
    expect(normalizeKeyName('KeyC')).toBe('C');
    expect(normalizeKeyName('KeyA')).toBe('A');
  });

  it('strips Digit prefix for numbers', () => {
    expect(normalizeKeyName('Digit5')).toBe('5');
  });

  it('renders arrows as glyphs', () => {
    expect(normalizeKeyName('ArrowUp')).toBe('↑');
    expect(normalizeKeyName('ArrowDown')).toBe('↓');
    expect(normalizeKeyName('ArrowLeft')).toBe('←');
    expect(normalizeKeyName('ArrowRight')).toBe('→');
  });

  it('uses friendly labels for special keys', () => {
    expect(normalizeKeyName('Escape')).toBe('Esc');
    expect(normalizeKeyName('PageUp')).toBe('Page Up');
  });

  it('passes through F-keys verbatim', () => {
    expect(normalizeKeyName('F1')).toBe('F1');
    expect(normalizeKeyName('F12')).toBe('F12');
  });

  it('falls through to raw code for unknown', () => {
    expect(normalizeKeyName('NumpadDecimal')).toBe('NumpadDecimal');
  });
});

describe('formatHotkey', () => {
  it('renders modifier order Ctrl + Shift + Alt + Meta', () => {
    const h: Hotkey = { ctrl: true, shift: true, alt: true, meta: true, key: 'KeyC' };
    expect(formatHotkey(h)).toBe('Ctrl + Shift + Alt + Meta + C');
  });

  it('renders modifierless key', () => {
    const h: Hotkey = { ctrl: false, shift: false, alt: false, meta: false, key: 'Insert' };
    expect(formatHotkey(h)).toBe('Insert');
  });

  it('default Ctrl+C', () => {
    const h: Hotkey = { ctrl: true, shift: false, alt: false, meta: false, key: 'KeyC' };
    expect(formatHotkey(h)).toBe('Ctrl + C');
  });
});

describe('captureHotkey', () => {
  it('reads modifier flags + event.code', () => {
    const ev = makeEvent({ code: 'KeyV', ctrlKey: true });
    expect(captureHotkey(ev)).toEqual({
      ctrl: true,
      shift: false,
      alt: false,
      meta: false,
      key: 'KeyV',
    });
  });

  it('uses event.code, not event.key (layout-independent)', () => {
    // Non-Latin layout would put 'с' in event.key but 'KeyC' stays in event.code.
    const ev = makeEvent({ code: 'KeyC', shiftKey: true });
    expect(captureHotkey(ev).key).toBe('KeyC');
  });
});

describe('matchesSingleHotkey', () => {
  const hotkey: Hotkey = { ctrl: true, shift: false, alt: false, meta: false, key: 'KeyC' };

  it('matches identical event', () => {
    expect(matchesSingleHotkey(makeEvent({ code: 'KeyC', ctrlKey: true }), hotkey)).toBe(true);
  });

  it('rejects event with different modifier', () => {
    expect(
      matchesSingleHotkey(makeEvent({ code: 'KeyC', ctrlKey: true, shiftKey: true }), hotkey),
    ).toBe(false);
  });

  it('rejects event with different code', () => {
    expect(matchesSingleHotkey(makeEvent({ code: 'KeyV', ctrlKey: true }), hotkey)).toBe(false);
  });

  it('refuses to match an empty-key hotkey definition', () => {
    // Regression for the +0.10 drift bug 2026-04-28: an unfilled placeholder
    // slot ({ key: '' }) used to match ANY keyboard event whose code was
    // also empty -- and Chrome dispatches such events for media keys
    // (Play/Pause buttons on keyboards/headsets/remotes), dead-keys, and
    // some IME composition states. matchesSingleHotkey now refuses to
    // match an empty key, eliminating the spurious +0.1 trigger.
    const empty: Hotkey = { ctrl: false, shift: false, alt: false, meta: false, key: '' };
    expect(matchesSingleHotkey(makeEvent({ code: '' }), empty)).toBe(false);
    expect(matchesSingleHotkey(makeEvent({ code: 'MediaPlayPause' }), empty)).toBe(false);
  });
});

describe('matchesHotkeyArray', () => {
  const hotkeys: Hotkey[] = [
    { ctrl: true, shift: false, alt: false, meta: false, key: 'KeyC' },
    { ctrl: false, shift: false, alt: false, meta: false, key: 'Insert' },
  ];

  it('returns true if any entry matches', () => {
    expect(matchesHotkeyArray(makeEvent({ code: 'KeyC', ctrlKey: true }), hotkeys)).toBe(true);
    expect(matchesHotkeyArray(makeEvent({ code: 'Insert' }), hotkeys)).toBe(true);
  });

  it('returns false when nothing matches', () => {
    expect(matchesHotkeyArray(makeEvent({ code: 'KeyX' }), hotkeys)).toBe(false);
  });

  it('handles undefined / non-array gracefully', () => {
    expect(matchesHotkeyArray(makeEvent({ code: 'KeyC' }), undefined)).toBe(false);
    expect(matchesHotkeyArray(makeEvent({ code: 'KeyC' }), [])).toBe(false);
    expect(matchesHotkeyArray(makeEvent({ code: 'KeyC' }), null as unknown as Hotkey[])).toBe(
      false,
    );
  });
});
