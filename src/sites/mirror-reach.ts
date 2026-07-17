/**
 * Mirror reachability classification.
 *
 * "Open HDRezka" used to probe with a no-cors HEAD and treat any fulfilled
 * fetch as "reachable". That is worthless: HDRezka's canonical domains are
 * frequently ISP-blocked with a stub or an anti-bot page that STILL returns
 * HTTP 200, so a HEAD marks a dead mirror reachable and we opened a blank page
 * (real bug, 2026-07 — hdrezka.ag redirect / rezka.ag "checking you're not a
 * bot" stub). The extension holds host permissions for the built-in mirrors,
 * so the background SW can read the body and decide from its content.
 *
 * Size is the discriminator, deliberately NOT template markers: mirror
 * homepages run different DLE themes (`b-content`, `oframecdnplayer` etc. are
 * not universal — measured absent on live mirrors), but a real HDRezka
 * homepage is content-heavy (40 KB+) and self-references "rezka", while an
 * anti-bot / parked stub comes back small (~4-5 KB). A 'challenge' can still
 * pass in a real browser tab (JS + cookies), so the caller may open it as a
 * fallback — but never a 'dead' one.
 */

export type MirrorReach = 'live' | 'challenge' | 'dead';

/** A real HDRezka homepage is never smaller than this; stubs never larger. */
export const MIN_LIVE_BYTES = 15_000;

/**
 * Decide a mirror's reachability from its homepage fetch result.
 * `ok` is the `Response.ok` (a >=400 status is dead); `body` is the decoded
 * text. Fetch failures (reject / timeout / DNS blackhole) are 'dead' and are
 * handled by the caller, which never calls this on a thrown fetch.
 */
export function classifyMirrorBody(ok: boolean, body: string): MirrorReach {
  if (!ok) return 'dead';
  if (body.length >= MIN_LIVE_BYTES && /rezka/i.test(body)) return 'live';
  return 'challenge';
}
