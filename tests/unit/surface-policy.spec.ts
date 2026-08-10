/**
 * The two Firefox behaviours that can only be CONFIRMED by a human — one ends
 * in a native permission doorhanger, the other in a real message to the
 * developer — but whose decision is ordinary logic. Pinned here so a change of
 * mind has to be deliberate rather than accidental.
 */

import { describe, expect, it } from 'vitest';
import { needsDetachedGrant, reviewUrl, shouldOfferReview } from '../../src/ui/surface-policy';

describe('needsDetachedGrant', () => {
  it('hands off to a detached window on Firefox, where the doorhanger hides behind the panel', () => {
    expect(needsDetachedGrant({ isFirefox: true, isDetached: false })).toBe(true);
  });

  it('asks directly once already detached — otherwise the hand-off loops forever', () => {
    expect(needsDetachedGrant({ isFirefox: true, isDetached: true })).toBe(false);
  });

  it('asks directly on Chrome, which centres its own prompt', () => {
    expect(needsDetachedGrant({ isFirefox: false, isDetached: false })).toBe(false);
    expect(needsDetachedGrant({ isFirefox: false, isDetached: true })).toBe(false);
  });
});

describe('shouldOfferReview', () => {
  it('offers the review link after positive feedback', () => {
    expect(shouldOfferReview({ rating: 'positive' })).toBe(true);
  });

  it.each([
    'neutral',
    'negative',
  ] as const)('never asks someone who reported a %s experience to go rate it', (rating) => {
    expect(shouldOfferReview({ rating })).toBe(false);
  });

  it('does not depend on the browser any more', () => {
    // This assertion used to be its mirror image: the ask was withheld unless
    // the build was Firefox, on the reasoning that AMO was the only store the
    // extension was listed in. The Chrome listings went live and the rule was
    // never revisited, so the ask was hidden from most of the audience while
    // the review count across the portfolio stayed at zero. Only the URL is
    // store-specific now.
    expect(shouldOfferReview({ rating: 'positive' })).toBe(true);
  });
});

describe('reviewUrl', () => {
  const urls = { amo: 'https://amo.example/reviews/', chrome: 'https://cws.example/reviews' };

  it('sends a Firefox build to AMO and a Chrome build to the Web Store', () => {
    expect(reviewUrl(true, urls)).toBe(urls.amo);
    expect(reviewUrl(false, urls)).toBe(urls.chrome);
  });

  it('never sends anyone to a store they cannot rate in', () => {
    // The failure this guards is silent: a wrong link still opens a real page,
    // and the person simply finds no way to leave the review they came for.
    expect(reviewUrl(true, urls)).not.toContain('cws.example');
    expect(reviewUrl(false, urls)).not.toContain('amo.example');
  });
});
