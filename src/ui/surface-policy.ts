/**
 * Two decisions the entrypoints used to make inline, in the one place tests
 * cannot see.
 *
 * `src/entrypoints/**` is excluded from coverage and is never imported by a
 * spec, so a condition written there is unverifiable by construction — both
 * bugs found on 2026-08-05 lived exactly there. These two rules are worth
 * pinning because neither can be checked automatically at the surface: one
 * ends in a native Firefox permission doorhanger, the other in a real message
 * sent to the developer. The DECISION can still be tested, even when the
 * consequence can only be looked at by a human.
 */

export interface GrantContext {
  /** Build target is Firefox (WXT's import.meta.env.BROWSER at the call site). */
  isFirefox: boolean;
  /** The popup is already running as a detached window (`popup.html?window=1`). */
  isDetached: boolean;
}

/**
 * Should the "grant access" click reopen the popup as a standalone window
 * before asking, instead of requesting the permission right here?
 *
 * Firefox anchors its permission doorhanger to the toolbar button — exactly
 * where the popup PANEL hangs — so "Allow" lands behind our own panel and
 * cannot be clicked; the button looks broken. A detached window no longer
 * covers the toolbar, so the doorhanger is reachable. Chrome centres its own
 * prompt and must ask directly, and a detached window must ask directly too,
 * or the hand-off would loop forever.
 */
export function needsDetachedGrant({ isFirefox, isDetached }: GrantContext): boolean {
  return isFirefox && !isDetached;
}

export interface ReviewOfferContext {
  /** What the user picked in the feedback form. */
  rating: 'positive' | 'neutral' | 'negative';
  /** Build target is Firefox. */
  isFirefox: boolean;
}

/**
 * Should the sent-feedback screen offer a link to the store review page?
 *
 * Only after positive feedback — asking someone who just reported a problem to
 * go rate the add-on is tone-deaf, and it is the one moment we know they are
 * pleased. Firefox only: AMO is the store this build is listed in, and a
 * Chrome user cannot rate there.
 */
export function shouldOfferReview({ rating, isFirefox }: ReviewOfferContext): boolean {
  return isFirefox && rating === 'positive';
}
