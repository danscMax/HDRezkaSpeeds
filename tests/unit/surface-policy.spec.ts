/**
 * The two Firefox behaviours that can only be CONFIRMED by a human — one ends
 * in a native permission doorhanger, the other in a real message to the
 * developer — but whose decision is ordinary logic. Pinned here so a change of
 * mind has to be deliberate rather than accidental.
 */

import { describe, expect, it } from 'vitest';
import { needsDetachedGrant, shouldOfferReview } from '../../src/ui/surface-policy';

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
  it('offers the review link after positive feedback on Firefox', () => {
    expect(shouldOfferReview({ rating: 'positive', isFirefox: true })).toBe(true);
  });

  it.each([
    'neutral',
    'negative',
  ] as const)('never asks someone who reported a %s experience to go rate it', (rating) => {
    expect(shouldOfferReview({ rating, isFirefox: true })).toBe(false);
  });

  it('stays silent on Chrome — this build is listed on AMO, where a Chrome user cannot rate', () => {
    expect(shouldOfferReview({ rating: 'positive', isFirefox: false })).toBe(false);
  });
});
