/**
 * "Has this profile ever been shown the one-time hint?" — one flag, one place.
 *
 * All of the teaching lives on the welcome page, which opens once at install
 * in a separate tab. A person who closes that tab never learns that click and
 * double-click differ, or that the gear holds the hotkeys: on the panel itself
 * the only explanation is a `title` attribute, i.e. hover-only and invisible
 * on a first look. This flag lets the panel say it once, in the place where it
 * matters, and never again.
 *
 * Deliberately NOT a settings key: it is not a preference, it must not appear
 * in export/import, and it must not be reset by "restore defaults".
 */

import type { StorageAdapter } from './adapter';

export const ONBOARDING_HINT_KEY = 'vs-onboarding-hint-seen';

export async function wasHintShown(adapter: StorageAdapter): Promise<boolean> {
  try {
    return (await adapter.get<boolean | null>(ONBOARDING_HINT_KEY, null)) === true;
  } catch {
    // Storage unavailable → claim it was shown. Staying quiet is the safe
    // failure: a hint repeated on every single page load is worse than a hint
    // that never appears.
    return true;
  }
}

export async function markHintShown(adapter: StorageAdapter): Promise<void> {
  try {
    await adapter.set(ONBOARDING_HINT_KEY, true);
  } catch {
    /* best-effort — worst case the hint shows once more */
  }
}
