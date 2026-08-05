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
 * "Can the extension work on at least one of its sites?" — one answer, asked
 * from more than one place.
 *
 * The badge is not the only surface that asks: the popup shows its "allow
 * access" banner off the same question, and the two disagreeing is worse than
 * either being wrong alone — a clean toolbar icon next to a panel claiming the
 * extension has no access reads as a broken extension. So the rule lives here
 * once, and every caller gets the same verdict.
 *
 * OR over the groups, AND inside one: a site needs all of its own patterns, but
 * one usable site is enough for the extension to work.
 *
 * Unable to tell → treated as usable. Crying wolf on a working install is worse
 * than missing the rare broken one, and it trains people to ignore the warning.
 */
export async function hasAnySiteAccess(
  permissions: PermissionProbe,
  originGroups: string[][],
): Promise<boolean> {
  const groups = originGroups.filter((g) => g.length > 0);
  if (groups.length === 0) return true;
  const results = await Promise.all(
    groups.map((origins) => permissions.contains({ origins }).catch(() => true)),
  );
  return results.some(Boolean);
}

/**
 * Returns true when at least one site is usable (badge cleared), false when it
 * warned.
 */
export async function refreshPermissionBadge(
  action: BadgeSurface,
  permissions: PermissionProbe,
  { originGroups, alertTitle }: PermissionBadgeOptions,
): Promise<boolean> {
  const held = await hasAnySiteAccess(permissions, originGroups);
  await action.setBadgeText({ text: held ? '' : '!' }).catch(() => undefined);
  await action
    .setBadgeBackgroundColor({ color: held ? BADGE_OK_COLOR : BADGE_ALERT_COLOR })
    .catch(() => undefined);
  await action.setTitle({ title: held ? '' : alertTitle }).catch(() => undefined);
  return held;
}
