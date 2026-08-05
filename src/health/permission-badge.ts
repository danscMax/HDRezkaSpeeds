/**
 * "The extension has no right to run here" — said on the toolbar icon.
 *
 * Firefox 127+ grants host permissions as part of the install flow, so a normal
 * install needs nothing from the user. Two documented cases leave the extension
 * without them anyway: permissions added by an extension UPDATE are neither
 * shown nor granted (Mozilla bug 1893232 — how a newly added mirror ends up
 * unusable), and access can be revoked from about:addons at any time. In both
 * cases the content script never starts: no panel, no error, nothing in the
 * console — indistinguishable from "the extension is broken".
 *
 * Lives in src/health/ rather than in each entrypoint because BOTH twins need
 * exactly this and the drift checker watches this directory — the previous
 * copy-pasted pair in the two background.ts files was invisible to it.
 *
 * The badge is set GLOBALLY; the per-tab speed badge overrides it wherever the
 * content script runs, which by definition is only where access exists.
 */

/** The slice of `browser.action` this needs — keeps the module browser-free. */
export interface BadgeSurface {
  setBadgeText(details: { text: string }): Promise<void>;
  setBadgeBackgroundColor(details: { color: string }): Promise<void>;
  setTitle(details: { title: string }): Promise<void>;
}

export interface PermissionProbe {
  contains(details: { origins: string[] }): Promise<boolean>;
}

/** Cyan is the product's own badge colour; red is reserved for "broken". */
export const BADGE_OK_COLOR = '#0e7490';
export const BADGE_ALERT_COLOR = '#c0392b';

export interface PermissionBadgeOptions {
  /**
   * One group per SITE the extension can work on — for HDRezka, one group per
   * mirror; each group holds that site's own patterns (wildcard + apex).
   *
   * Grouped rather than one flat list because the flat list meant AND over
   * every pattern: a single mirror added in an update and therefore ungranted
   * (the exact case this badge was built for) painted a permanent red "!" on
   * profiles whose actual mirror worked fine. A warning that is usually wrong
   * teaches people to ignore it. The badge now means what it says — the
   * extension cannot work ANYWHERE.
   */
  originGroups: string[][];
  /** Tooltip shown while access is missing, already in the user's language. */
  alertTitle: string;
}

/**
 * Returns true when at least one site is usable (badge cleared), false when it
 * warned.
 *
 * Unable to tell → treated as usable. Crying wolf on a working install is worse
 * than missing the rare broken one, and it trains people to ignore the badge.
 */
export async function refreshPermissionBadge(
  action: BadgeSurface,
  permissions: PermissionProbe,
  { originGroups, alertTitle }: PermissionBadgeOptions,
): Promise<boolean> {
  const groups = originGroups.filter((g) => g.length > 0);
  if (groups.length === 0) return true;
  const results = await Promise.all(
    groups.map((origins) => permissions.contains({ origins }).catch(() => true)),
  );
  const held = results.some(Boolean);
  await action.setBadgeText({ text: held ? '' : '!' }).catch(() => undefined);
  await action
    .setBadgeBackgroundColor({ color: held ? BADGE_OK_COLOR : BADGE_ALERT_COLOR })
    .catch(() => undefined);
  await action.setTitle({ title: held ? '' : alertTitle }).catch(() => undefined);
  return held;
}
