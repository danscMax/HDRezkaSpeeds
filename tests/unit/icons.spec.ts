import { describe, expect, it } from 'vitest';
import { ICON_NAMES, vsFilledGearIcon, vsIcon } from '../../src/ui/icons';

const SVG_NS = 'http://www.w3.org/2000/svg';

describe('vsIcon()', () => {
  it('returns a real SVGElement with the requested size', () => {
    const out = vsIcon('settings', 16);
    expect(out).toBeInstanceOf(SVGElement);
    expect(out.tagName.toLowerCase()).toBe('svg');
    expect(out.namespaceURI).toBe(SVG_NS);
    expect(out.getAttribute('width')).toBe('16');
    expect(out.getAttribute('height')).toBe('16');
    expect(out.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(out.getAttribute('stroke')).toBe('currentColor');
  });

  it('defaults size to 14', () => {
    const out = vsIcon('plus');
    expect(out.getAttribute('width')).toBe('14');
    expect(out.getAttribute('height')).toBe('14');
  });

  it('returns empty SVG (no children) for unknown name', () => {
    const out = vsIcon('not-a-real-icon' as unknown as 'plus');
    expect(out.tagName.toLowerCase()).toBe('svg');
    expect(out.children.length).toBe(0);
  });

  it('exposes ICON_NAMES with the full set', () => {
    // 28 icons: 22 from the original userscript + globe (language
    // switcher) + heart (donate tab) + external-link (donate links)
    // + help-circle (welcome page link in modal header) + mail
    // (feedback CTA, added in 0.2.x feedback flow) + bookmark
    // (pin/save-as-default button, added in 0.3.15).
    expect(ICON_NAMES.length).toBe(28);
    expect(ICON_NAMES).toContain('globe');
    expect(ICON_NAMES).toContain('settings');
    expect(ICON_NAMES).toContain('heart');
    expect(ICON_NAMES).toContain('external-link');
    expect(ICON_NAMES).toContain('help-circle');
    expect(ICON_NAMES).toContain('mail');
    expect(ICON_NAMES).toContain('bookmark');
  });

  it('every icon name renders without throwing and yields an SVGElement', () => {
    for (const name of ICON_NAMES) {
      expect(() => vsIcon(name)).not.toThrow();
      const out = vsIcon(name);
      expect(out).toBeInstanceOf(SVGElement);
      expect(out.tagName.toLowerCase()).toBe('svg');
      // Each icon has at least one primitive child (path / circle / line / rect / polyline).
      expect(out.children.length).toBeGreaterThan(0);
      // Children must inherit the SVG namespace, not XHTML.
      for (const child of Array.from(out.children)) {
        expect(child.namespaceURI).toBe(SVG_NS);
      }
    }
  });

  it('vsFilledGearIcon returns a filled SVG with data-filled marker', () => {
    const out = vsFilledGearIcon(20);
    expect(out).toBeInstanceOf(SVGElement);
    expect(out.getAttribute('width')).toBe('20');
    expect(out.getAttribute('fill')).toBe('currentColor');
    expect(out.hasAttribute('data-filled')).toBe(true);
    expect(out.children.length).toBe(1);
    expect(out.firstElementChild?.tagName.toLowerCase()).toBe('path');
  });
});
