import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Validators } from '../../src/discovery/validators';

beforeEach(() => {
  document.body.innerHTML = '';
  // happy-dom returns 0/0 for getBoundingClientRect on detached and even
  // attached elements; stub a positive geometry for elements that need it.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 800,
    height: 450,
    top: 0,
    left: 0,
    right: 800,
    bottom: 450,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('Validators.video', () => {
  it('accepts a normal-sized <video>', () => {
    const v = document.createElement('video');
    document.body.appendChild(v);
    expect(Validators.video(v).ok).toBe(true);
  });

  it('rejects non-video element', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    expect(Validators.video(div).ok).toBe(false);
  });

  it('rejects thumbnail-sized video that has src', () => {
    const v = document.createElement('video');
    v.src = 'blob:fake';
    document.body.appendChild(v);
    vi.spyOn(v, 'getBoundingClientRect').mockReturnValue({
      width: 50,
      height: 30,
      top: 0,
      left: 0,
      right: 50,
      bottom: 30,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    expect(Validators.video(v).ok).toBe(false);
  });

  it('accepts srcless small video (loading state)', () => {
    const v = document.createElement('video');
    document.body.appendChild(v);
    vi.spyOn(v, 'getBoundingClientRect').mockReturnValue({
      width: 50,
      height: 30,
      top: 0,
      left: 0,
      right: 50,
      bottom: 30,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    expect(Validators.video(v).ok).toBe(true);
  });

  it('rejects autoplay-preview style video (muted+loop+small)', () => {
    const v = document.createElement('video');
    v.src = 'blob:fake';
    v.muted = true;
    v.loop = true;
    document.body.appendChild(v);
    vi.spyOn(v, 'getBoundingClientRect').mockReturnValue({
      width: 200,
      height: 110,
      top: 0,
      left: 0,
      right: 200,
      bottom: 110,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    expect(Validators.video(v).ok).toBe(false);
  });
});

describe('Validators.playerContainer', () => {
  it('accepts a div containing <video> with reasonable size', () => {
    const div = document.createElement('div');
    div.appendChild(document.createElement('video'));
    document.body.appendChild(div);
    expect(Validators.playerContainer(div).ok).toBe(true);
  });

  it('rejects detached element', () => {
    const div = document.createElement('div');
    expect(Validators.playerContainer(div).ok).toBe(false);
  });

  it('rejects div without <video> descendant', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    expect(Validators.playerContainer(div).ok).toBe(false);
  });

  it('rejects too-small container even with video', () => {
    const div = document.createElement('div');
    div.appendChild(document.createElement('video'));
    document.body.appendChild(div);
    vi.spyOn(div, 'getBoundingClientRect').mockReturnValue({
      width: 100,
      height: 50,
      top: 0,
      left: 0,
      right: 100,
      bottom: 50,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    expect(Validators.playerContainer(div).ok).toBe(false);
  });
});

describe('Validators.infoElem', () => {
  it('rejects empty element (no children)', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    expect(Validators.infoElem(div).ok).toBe(false);
  });

  it('accepts an element with children near the <video> in DOM', () => {
    const wrapper = document.createElement('div');
    wrapper.appendChild(document.createElement('video'));
    const info = document.createElement('div');
    info.appendChild(document.createElement('h1')); // non-empty
    wrapper.appendChild(info);
    document.body.appendChild(wrapper);

    expect(Validators.infoElem(info).ok).toBe(true);
  });
});

describe('Validators.leftControls / rightControls', () => {
  it('accepts a control container with a <button> inside', () => {
    const div = document.createElement('div');
    div.appendChild(document.createElement('button'));
    document.body.appendChild(div);
    expect(Validators.leftControls(div).ok).toBe(true);
    expect(Validators.rightControls(div).ok).toBe(true);
  });

  it('rejects empty container', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    expect(Validators.leftControls(div).ok).toBe(false);
  });
});

describe('Validators.controlsContainer', () => {
  it('rejects too-narrow container', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    Object.defineProperty(div, 'clientWidth', { value: 100 });
    expect(Validators.controlsContainer(div).ok).toBe(false);
  });

  it('accepts wide-enough container', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    Object.defineProperty(div, 'clientWidth', { value: 600 });
    expect(Validators.controlsContainer(div).ok).toBe(true);
  });
});
