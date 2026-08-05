import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetForTests,
  detectAndClaim,
  EXT_MARKER_ATTR,
  hasVisibleArtifact,
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

    it('PROCEEDS when the only artifact is invisible — a hidden leftover is not a rival', () => {
      // Three or more userscripts run on a real HDRezka page; a generic
      // `.speed-button` left hidden by any of them (or by our own failed
      // teardown) used to deny our entire UI with nothing on screen to explain
      // it. Denial-of-service by collateral, not by conflict.
      const ghost = document.createElement('div');
      ghost.className = 'speed-button';
      document.body.appendChild(ghost);

      expect(detectAndClaim().proceed).toBe(true);
    });

    it('refuses when legacy TM DOM artifact is present (.speed-button)', () => {
      const btn = document.createElement('div');
      btn.className = 'speed-button';
      // A REAL userscript control occupies space. jsdom reports a zero box for
      // everything, and a zero box now means "hidden leftover, not a rival" —
      // so the fixture has to say which of the two it is modelling.
      btn.getBoundingClientRect = () => ({ width: 44, height: 24 }) as DOMRect;
      document.body.appendChild(btn);

      const result = detectAndClaim();

      expect(result.proceed).toBe(false);
      expect(result.reason).toBe('tm-userscript-active');
      expect(document.documentElement.hasAttribute(EXT_MARKER_ATTR)).toBe(false);
    });

    it('refuses when legacy TM DOM artifact is present (#more-speeds-container)', () => {
      const cont = document.createElement('div');
      cont.id = 'more-speeds-container';
      cont.getBoundingClientRect = () => ({ width: 180, height: 40 }) as DOMRect;
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

describe('hasVisibleArtifact — a control nobody can see is not a conflict', () => {
  const withBody = (html: string): Document => {
    const doc = document.implementation.createHTMLDocument('t');
    doc.body.innerHTML = html;
    return doc;
  };

  it('ignores an artifact with no box', () => {
    // jsdom gives every element a zero rect, which is exactly the "hidden
    // leftover" case: our own failed teardown, or an unrelated script's node.
    // Three or more userscripts run on a real HDRezka page, so this collision
    // is routine — and its old cost was the whole UI never appearing.
    expect(hasVisibleArtifact(withBody('<div class="speed-button">1.5x</div>'))).toBe(false);
  });

  it('still bails on an artifact that occupies space', () => {
    const doc = withBody('<div id="more-speeds-container"></div>');
    const el = doc.getElementById('more-speeds-container') as HTMLElement;
    el.getBoundingClientRect = () => ({ width: 120, height: 32 }) as DOMRect;
    expect(hasVisibleArtifact(doc)).toBe(true);
  });

  it('says no when the page is clean', () => {
    expect(hasVisibleArtifact(withBody('<div class="unrelated"></div>'))).toBe(false);
  });
});
