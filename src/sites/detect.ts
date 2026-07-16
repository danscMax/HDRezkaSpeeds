/**
 * Site detection from `location.hostname`. The single source of truth for
 * "which Site does this content script live on". Returns null on the rare
 * case the script ends up on an unrelated host (defensive — the manifest
 * already restricts matches).
 *
 * Supported HDRezka mirrors match BUILTIN_MIRROR_HOSTS in
 * sites/mirror-hosts.ts (the manifest host_permissions source): the
 * canonical .ag plus historical/regional .me, .co, .website, .cm, .tv,
 * standby-rezka.tv, plus rezkify / rezkery / kinopub aliases. Keep the
 * regexes below in sync when that list changes. User-added mirrors are
 * NOT detected here — bootstrap() falls back to the mirrors store when
 * this returns null.
 */

import { selectorsFor } from '../discovery/selectors';
import type { Site } from '../app/ports';

export function detectSite(host: string = safeHostname()): Site | null {
  const h = host.toLowerCase();
  // Anchored regexes — bare `h.includes('hdrezka')`/`h.includes('rezka.')`
  // would match attacker-controlled `hdrezka.evil.tld`, `evil-rezka.com`
  // (popup calls detectSite over arbitrary tab URLs; audit 2026-05-09).
  // The catch-all wildcards stay anchored to a TLD to permit unknown
  // future mirror domains without opening up substring spoofing.
  if (
    /(?:^|\.)hdrezka\.(?:ag|me|co|website|cm)$/.test(h) ||
    /(?:^|\.)rezka\.(?:ag|me|co|website|cm)$/.test(h) ||
    /(?:^|\.)hdrezka-home\.tv$/.test(h) ||
    // standby-rezka.tv: the `rezka.[tld]` wildcard below does NOT match it
    // (hyphenated prefix breaks the `(?:^|\.)` anchor), so list explicitly.
    /(?:^|\.)standby-rezka\.tv$/.test(h) ||
    /(?:^|\.)rezkify\.com$/.test(h) ||
    /(?:^|\.)rezkery\.com$/.test(h) ||
    /(?:^|\.)kinopub\.me$/.test(h) ||
    /(?:^|\.)hdrezka\.[a-z]{2,8}$/.test(h) ||
    /(?:^|\.)rezka\.[a-z]{2,8}$/.test(h)
  ) {
    return 'hdrezka';
  }
  return null;
}

/**
 * Content-signature fallback: is THIS page an HDRezka mirror, judged by the
 * engine's DOM rather than the domain name? Every mirror runs the same
 * front-end, so name-based lists (and even a `hdrezka.*` regex) lose to
 * renamed / hash-prefixed domains — but the DOM signature is stable.
 *
 * Only consulted in auto-follow mode (the broad content script self-bails
 * on non-HDRezka pages via this check). Reuses the discovery selector
 * tables so class-name changes are maintained in one place.
 *
 * Match rule (near-zero false positives):
 *   - `#oframecdnplayer` present  -> yes (near-unique HDRezka CDN player), OR
 *   - a player wrapper AND a content/info block both present.
 */
export function looksLikeHDRezka(doc: Document = document): boolean {
  const q = (sel: string): boolean => {
    try {
      return doc.querySelector(sel) !== null;
    } catch {
      return false;
    }
  };
  if (q('#oframecdnplayer')) return true;
  const sel = selectorsFor('hdrezka');
  const anyMatch = (list: readonly string[] | undefined): boolean =>
    !!list && list.some(q);
  return anyMatch(sel.playerContainer) && anyMatch(sel.infoElem);
}

/**
 * Allow-list of HDRezka URL patterns that actually host a playable video.
 *
 * HDRezka video pages always end in `.html` and live under one of:
 *   /films/<genre>/<id>-<slug>.html
 *   /series/<genre>/<id>-<slug>.html
 *   /cartoons/<genre>/<id>-<slug>.html
 *   /animation/<genre>/<id>-<slug>.html
 *   /show/<id>-<slug>.html
 *   /documentary/<id>-<slug>.html
 *
 * Everything else (list pages like /continue/, /favorites/, /personal/,
 * category indexes, search, profile, etc.) returns false — those pages
 * have no <video>, so our DiscoveryEngine's heuristic strategies must
 * NOT promote a random container to "playerContainer" and drop the
 * speed panel into a non-video layout.
 */
export function isHDRezkaVideoPath(pathname: string = safePathname()): boolean {
  return /\.html$/i.test(pathname);
}

/**
 * FEAT-015: stable per-title key for the speed-memory map. HDRezka URLs
 * embed a numeric title id (`/series/<genre>/12345-slug.html`) that stays
 * the same across every episode/season of a show — so remembering by id
 * gives "per-series memory" for free. Returns null on unrecognised paths.
 */
export function extractHDRezkaTitleId(pathname: string = safePathname()): string | null {
  const m = /\/(\d+)-[^/]*\.html$/i.exec(pathname);
  return m ? (m[1] ?? null) : null;
}

/**
 * FEAT-018: episode-granular resume key. The title id alone is per-SERIES
 * (every episode of a show shares one URL — HDRezka swaps episodes via AJAX
 * without changing the path), which is right for speed memory but WRONG for
 * resume: episode 2 would be offered episode 1's position. Compose the
 * active season/episode into the key so each episode resumes independently.
 *
 * HDRezka marks the current episode with `.b-simple_episode__item.active`,
 * carrying `data-season_id` / `data-episode_id` (verified against the HDRezka
 * scraper ecosystem + the HDrezka-Improvement userscript, 2026-07). A movie
 * has no episode list, so this falls back to the bare title id.
 */
export function extractHDRezkaEpisodeKey(titleId: string, doc: Document = document): string {
  try {
    const active = doc.querySelector('.b-simple_episode__item.active');
    if (active) {
      const season = active.getAttribute('data-season_id') ?? '';
      const episode = active.getAttribute('data-episode_id') ?? '';
      if (season && episode) return `${titleId}:s${season}e${episode}`;
      if (episode) return `${titleId}:e${episode}`;
    }
  } catch {
    // Malformed selector engine / detached doc — fall back to per-title.
  }
  return titleId;
}

function safeHostname(): string {
  try {
    return location.hostname;
  } catch {
    return '';
  }
}

function safePathname(): string {
  try {
    return location.pathname;
  } catch {
    return '';
  }
}
