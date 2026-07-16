import { afterEach, describe, expect, it } from 'vitest';
import { extractHDRezkaEpisodeKey, looksLikeHDRezka } from '../../src/sites/detect';

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

describe('extractHDRezkaEpisodeKey()', () => {
  afterEach(reset);

  it('falls back to the bare title id for a movie (no episode list)', () => {
    expect(extractHDRezkaEpisodeKey('12345')).toBe('12345');
  });

  it('composes season + episode from the active episode item', () => {
    document.body.innerHTML =
      '<ul class="b-simple_episodes__list">' +
      '<li class="b-simple_episode__item" data-season_id="1" data-episode_id="1">1</li>' +
      '<li class="b-simple_episode__item active" data-season_id="2" data-episode_id="5">5</li>' +
      '</ul>';
    expect(extractHDRezkaEpisodeKey('12345')).toBe('12345:s2e5');
  });

  it('gives two different episodes of one series distinct keys', () => {
    document.body.innerHTML =
      '<li class="b-simple_episode__item active" data-season_id="1" data-episode_id="1">1</li>';
    const e1 = extractHDRezkaEpisodeKey('999');
    reset();
    document.body.innerHTML =
      '<li class="b-simple_episode__item active" data-season_id="1" data-episode_id="2">2</li>';
    const e2 = extractHDRezkaEpisodeKey('999');
    expect(e1).not.toBe(e2);
    expect(e1).toBe('999:s1e1');
    expect(e2).toBe('999:s1e2');
  });

  it('uses episode alone when season id is absent', () => {
    document.body.innerHTML =
      '<li class="b-simple_episode__item active" data-episode_id="7">7</li>';
    expect(extractHDRezkaEpisodeKey('42')).toBe('42:e7');
  });
});
