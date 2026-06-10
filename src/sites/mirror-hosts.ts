/**
 * Canonical list of built-in HDRezka mirror hosts and helpers to derive
 * match patterns / origin patterns from a host.
 *
 * Single source of truth consumed by:
 *   - wxt.config.ts            -> manifest host_permissions (build time)
 *   - entrypoints/content.ts   -> content script `matches` (build time)
 *   - storage/mirrors-store.ts -> "already built-in" duplicate checks
 *   - entrypoints/background.ts-> dynamic registration for user mirrors
 *   - ui/settings              -> read-only built-ins list in the Mirrors tab
 *
 * IMPORTANT: this module is imported from `wxt.config.ts`, which is
 * evaluated in Node at build time (via c12/jiti). Keep it pure data —
 * no `wxt/browser` imports, no browser globals, no side effects.
 *
 * `src/sites/detect.ts` keeps its anchored-regex detection (it also
 * accepts unknown future `hdrezka.*`/`rezka.*` TLDs); when editing this
 * list, mirror the change there.
 */

export const BUILTIN_MIRROR_HOSTS: readonly string[] = [
  'hdrezka.ag',
  'rezka.ag',
  'hdrezka.me',
  'hdrezka.co',
  'hdrezka.website',
  'hdrezka.cm',
  'hdrezka-home.tv',
  'rezkify.com',
  'rezkery.com',
  'kinopub.me',
  'standby-rezka.tv',
] as const;

/**
 * Origin/match pattern pair for one host: subdomains + the bare apex.
 * Some docs imply `*://*.host/*` also matches the apex, but Chrome and
 * Firefox have disagreed on that historically — double-listing is the
 * convention this manifest has always used.
 */
export function originPatternsFor(host: string): [string, string] {
  return [`*://*.${host}/*`, `*://${host}/*`];
}

/** Manifest-ready match patterns for every built-in mirror (2 per host). */
export function builtinMatchPatterns(): string[] {
  return BUILTIN_MIRROR_HOSTS.flatMap((host) => originPatternsFor(host));
}

/**
 * True when `host` equals an entry of `list` or is a subdomain of one
 * (`static.hdrezka.ag` is covered by `hdrezka.ag`). Both sides are
 * expected lowercase. Suffix check is dot-anchored so attacker-style
 * `evil-rezka.ag` does NOT match `rezka.ag`.
 */
export function isCoveredByHostList(host: string, list: readonly string[]): boolean {
  return list.some((entry) => host === entry || host.endsWith(`.${entry}`));
}
