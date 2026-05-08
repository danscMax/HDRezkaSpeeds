import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetForTests,
  detectAndClaim,
  EXT_MARKER_ATTR,
  release,
  TM_MARKER_ATTR,
} from '../../src/utils/tm-coexist';

describe('tm-coexist', () => {
  beforeEach(() => {
    __resetForTests();
  });

  afterEach(() => {
    __resetForTests();
  });

  describe('detectAndClaim()', () => {
    it('returns { proceed: true } and sets the ext marker on a clean page', () => {
      const result = detectAndClaim();

      expect(result).toEqual({ proceed: true });
      expect(document.documentElement.getAttribute(EXT_MARKER_ATTR)).toBe('1');
    });

    it('refuses when TM marker is present', () => {
      document.documentElement.setAttribute(TM_MARKER_ATTR, '1');

      const result = detectAndClaim();

      expect(result).toEqual({
        proceed: false,
        reason: 'tm-userscript-active',
      });
      // Did NOT claim its own marker after losing.
      expect(document.documentElement.hasAttribute(EXT_MARKER_ATTR)).toBe(false);
    });

    it('refuses when legacy TM DOM artifact is present (.speed-button)', () => {
      const btn = document.createElement('div');
      btn.className = 'speed-button';
      document.body.appendChild(btn);

      const result = detectAndClaim();

      expect(result.proceed).toBe(false);
      expect(result.reason).toBe('tm-userscript-active');
      expect(document.documentElement.hasAttribute(EXT_MARKER_ATTR)).toBe(false);
    });

    it('refuses when legacy TM DOM artifact is present (#more-speeds-container)', () => {
      const cont = document.createElement('div');
      cont.id = 'more-speeds-container';
      document.body.appendChild(cont);

      const result = detectAndClaim();

      expect(result).toEqual({
        proceed: false,
        reason: 'tm-userscript-active',
      });
    });

    it('refuses when ext marker is already set (re-injection)', () => {
      document.documentElement.setAttribute(EXT_MARKER_ATTR, '1');

      const result = detectAndClaim();

      expect(result).toEqual({
        proceed: false,
        reason: 'extension-already-injected',
      });
    });

    it('TM marker takes priority over ext marker when both are set', () => {
      // Edge case: stale ext marker from a prior load + TM userscript now active.
      // We should report TM, not "already-injected", so the diagnostic is
      // actionable for the user (disable the userscript).
      document.documentElement.setAttribute(TM_MARKER_ATTR, '1');
      document.documentElement.setAttribute(EXT_MARKER_ATTR, '1');

      const result = detectAndClaim();

      expect(result.reason).toBe('tm-userscript-active');
    });
  });

  describe('release()', () => {
    it('removes the ext marker', () => {
      detectAndClaim();
      expect(document.documentElement.hasAttribute(EXT_MARKER_ATTR)).toBe(true);

      release();

      expect(document.documentElement.hasAttribute(EXT_MARKER_ATTR)).toBe(false);
    });

    it('is safe to call when no marker is set', () => {
      expect(() => release()).not.toThrow();
    });

    it('does not touch the TM marker', () => {
      document.documentElement.setAttribute(TM_MARKER_ATTR, '1');
      release();
      expect(document.documentElement.getAttribute(TM_MARKER_ATTR)).toBe('1');
    });
  });

  describe('claim -> release -> reclaim cycle', () => {
    it('lets the next claim succeed after release', () => {
      expect(detectAndClaim().proceed).toBe(true);
      release();
      expect(detectAndClaim().proceed).toBe(true);
    });
  });
});
