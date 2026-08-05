/**
 * The manifest is the contract with the browser, and it is BUILT from other
 * files. A mirror added to src/sites/mirror-hosts.ts without its consequences
 * reaching host_permissions and the CSP is the exact shape of "silently broken
 * for Firefox users after an update": the content script loads, the reachability
 * probe is blocked by connect-src, every mirror reads as dead, and nothing says
 * why. Nothing tested wxt.config.ts before this file.
 */

import { describe, expect, it } from 'vitest';
import { BUILTIN_MIRROR_HOSTS, builtinMatchPatterns } from '../../src/sites/mirror-hosts';
import config from '../../wxt.config';

type ManifestFn = (env: { browser: string }) => Record<string, unknown>;

const manifestFor = (browser: string): Record<string, unknown> =>
  (config.manifest as unknown as ManifestFn)({ browser });

const chrome = manifestFor('chrome');
const firefox = manifestFor('firefox');

describe('manifest is derived from the single host list', () => {
  it.each(['chrome', 'firefox'])('%s: host_permissions cover every built-in mirror', (browser) => {
    const patterns = manifestFor(browser).host_permissions as string[];
    expect(patterns).toEqual(builtinMatchPatterns());
    for (const host of BUILTIN_MIRROR_HOSTS) {
      expect(patterns).toContain(`*://${host}/*`);
      expect(patterns).toContain(`*://*.${host}/*`);
    }
  });

  it.each(['chrome', 'firefox'])('%s: connect-src allows probing every mirror', (browser) => {
    const csp = manifestFor(browser).content_security_policy as { extension_pages?: string };
    expect(csp?.extension_pages).toBeTruthy();
    for (const host of BUILTIN_MIRROR_HOSTS) {
      // Firefox runs the background as an extension PAGE, so the mirror-reach
      // probe is subject to this policy — a missing host makes that mirror
      // look permanently dead.
      expect(csp?.extension_pages).toContain(`https://${host}`);
    }
  });
});

describe('permissions stay least-privilege and per-target', () => {
  it('keeps broad host access optional, never granted at install', () => {
    for (const m of [chrome, firefox]) {
      expect(m.optional_host_permissions).toEqual(['*://*/*']);
      expect(m.permissions as string[]).not.toContain('*://*/*');
      expect(m.permissions as string[]).not.toContain('tabs');
    }
  });

  it('asks for system.display only where it exists', () => {
    // FEAT-020 reads the monitor bounds through it. Firefox has no such API,
    // and an unknown permission there is a store-validation warning.
    expect(chrome.permissions as string[]).toContain('system.display');
    expect(firefox.permissions as string[]).not.toContain('system.display');
  });

  it('ships a stable Firefox add-on id — storage and AMO updates hang off it', () => {
    const gecko = (firefox.browser_specific_settings as { gecko?: { id?: string } })?.gecko;
    expect(gecko?.id).toBe('hdrezka-speeds@maxscorpy');
    expect(chrome.browser_specific_settings).toBeUndefined();
  });
});
