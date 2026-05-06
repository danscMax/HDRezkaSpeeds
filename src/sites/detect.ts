/**
 * Site detection from `location.hostname`. The single source of truth for
 * "which Site does this content script live on". Returns null on the rare
 * case the script ends up on an unrelated host (defensive — the manifest
 * already restricts matches).
 *
 * Supported HDRezka mirrors match the host_permissions list in
 * wxt.config.ts: the canonical .ag plus historical/regional .me, .co,
 * .website, .cm, .tv, plus rezkify / rezkery / kinopub aliases.
 */

import type { Site } from '../app/ports';

export function detectSite(host: string = safeHostname()): Site | null {
  const h = host.toLowerCase();
  if (
    /(?:^|\.)hdrezka\.(?:ag|me|co|website|cm)$/.test(h) ||
    /(?:^|\.)rezka\.(?:ag|me|co|website|cm)$/.test(h) ||
    /(?:^|\.)hdrezka-home\.tv$/.test(h) ||
    /(?:^|\.)rezkify\.com$/.test(h) ||
    /(?:^|\.)rezkery\.com$/.test(h) ||
    /(?:^|\.)kinopub\.me$/.test(h) ||
    h.includes('hdrezka') ||
    h.includes('rezka.')
  ) {
    return 'hdrezka';
  }
  return null;
}

export function isHDRezka(host?: string): boolean {
  return detectSite(host) === 'hdrezka';
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
