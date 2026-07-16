import { afterEach, describe, expect, it } from 'vitest';
import { looksLikeHDRezka } from '../../src/sites/detect';

// Content-signature detection (part B): recognise an HDRezka mirror by the
// engine's DOM rather than the domain name, so renamed / hash-prefixed
// mirrors still work in auto-follow mode.

function reset(): void {
  document.body.innerHTML = '';
}

describe('looksLikeHDRezka()', () => {
  afterEach(reset);

  it('matches on the #oframecdnplayer CDN player alone', () => {
    document.body.innerHTML = '<div id="oframecdnplayer"></div>';
    expect(looksLikeHDRezka()).toBe(true);
  });

  it('matches a player wrapper + movie info block together', () => {
    document.body.innerHTML = '<div class="b-player"></div><div class="b-post__info"></div>';
    expect(looksLikeHDRezka()).toBe(true);
  });

  it('matches with the series episode list as the info block', () => {
    document.body.innerHTML =
      '<div class="b-player"></div><ul class="b-content__inline_items"></ul>';
    expect(looksLikeHDRezka()).toBe(true);
  });

  it('does NOT match a lone player wrapper with no info block', () => {
    document.body.innerHTML = '<div class="b-player"></div>';
    expect(looksLikeHDRezka()).toBe(false);
  });

  it('does NOT match a random non-HDRezka page', () => {
    document.body.innerHTML = '<div class="video-player"></div><article class="post"></article>';
    expect(looksLikeHDRezka()).toBe(false);
  });

  it('accepts an explicit document argument', () => {
    const doc = document.implementation.createHTMLDocument('t');
    doc.body.innerHTML = '<div id="oframecdnplayer"></div>';
    expect(looksLikeHDRezka(doc)).toBe(true);
  });
});
