import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../src/i18n/translator';
import { defaultSettings } from '../../src/storage/types';
import type { MirrorsViewModel } from '../../src/ui/settings/mirrors-block';
import { renderSettingsMenu } from '../../src/ui/settings/modal';

// Renders the real settings menu (the popup's own render path) and inspects
// the produced DOM — the closest thing to "looking at the UI" in a unit test:
// confirms the auto-follow toggle + "Open HDRezka" button + translated
// strings appear on the popup surface and are hidden in-player.

function render(canManagePermissions: boolean, autoFollow: boolean): DocumentFragment {
  const mirrors: MirrorsViewModel = {
    builtinHosts: ['hdrezka.ag'],
    userHosts: [],
    status: {},
    builtinStatus: {},
    canManagePermissions,
    autoFollow,
    maxMirrors: 30,
  };
  return renderSettingsMenu({
    settings: defaultSettings('en', 'hdrezka'),
    site: 'hdrezka',
    i18n: createTranslator('en'),
    activeTab: 'mirrors',
    scriptVersion: '0.6.0',
    mirrors,
  });
}

describe('Mirrors tab — auto-follow + open (popup surface)', () => {
  it('renders the toggle, Open button, and translated labels when permissions are manageable', () => {
    const frag = render(true, false);
    expect(frag.querySelector('[data-vs-mirror-open]')).not.toBeNull();
    const toggle = frag.querySelector<HTMLInputElement>('input[name="autofollow-mirrors"]');
    expect(toggle).not.toBeNull();
    expect(toggle?.checked).toBe(false);
    expect(frag.textContent).toContain('Work on any HDRezka mirror');
    expect(frag.textContent).toContain('Open HDRezka');
  });

  it('reflects the autoFollow=true state on the toggle', () => {
    const toggle = render(true, true).querySelector<HTMLInputElement>(
      'input[name="autofollow-mirrors"]',
    );
    expect(toggle?.checked).toBe(true);
  });

  it('hides the popup-only controls on the in-player surface', () => {
    const frag = render(false, false);
    expect(frag.querySelector('[data-vs-mirror-open]')).toBeNull();
    expect(frag.querySelector('input[name="autofollow-mirrors"]')).toBeNull();
  });
});
