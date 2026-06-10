/**
 * User-defined mirror hosts ("my HDRezka mirrors").
 *
 * HDRezka mirrors rotate constantly; shipping a manifest update for every
 * new domain doesn't scale. Users add their own mirror hosts at runtime:
 * the list lives in `browser.storage.local` under MIRRORS_STORAGE_KEY,
 * while the background service worker owns the matching
 * `scripting.registerContentScripts` registration (see
 * entrypoints/background.ts). Permission state is never stored here —
 * it is always derived live from `browser.permissions.contains`.
 *
 * Storage schema: `{ hosts: string[] }` — normalized (lowercase,
 * punycoded, no scheme/port/path, no leading `www.`) hostnames only.
 *
 * Every read goes through `sanitizeMirrorList`, so corrupt shapes,
 * duplicates, hosts covered by built-ins and over-cap tails are dropped
 * on read (popup and in-player surfaces write concurrently —
 * last-write-wins plus sanitize-on-read keeps every reader consistent).
 */

import { BUILTIN_MIRROR_HOSTS, isCoveredByHostList } from '../sites/mirror-hosts';
import type { StorageAdapter } from './adapter';

export const MIRRORS_STORAGE_KEY = 'hdrezka-user-mirrors';

/** Sanity cap — nobody juggles 30 live mirrors; defends storage + UI. */
export const MAX_USER_MIRRORS = 30;

export type MirrorRejectReason =
  /** Blank input. */
  | 'empty'
  /** Explicit non-http(s) scheme: chrome://, moz-extension://, ftp://… */
  | 'scheme'
  /** Unparseable / illegal hostname characters / too long. */
  | 'invalid'
  /** IP literals — `*://*.1.2.3.4/*` is not a valid match pattern. */
  | 'ip'
  /** Single-label host (`localhost`): can't be a public mirror. */
  | 'no_dot'
  /** Equal to or subdomain of a built-in mirror — already supported. */
  | 'builtin'
  /** Equal to or covered by an existing user mirror. */
  | 'duplicate'
  /** MAX_USER_MIRRORS reached. */
  | 'limit';

export type NormalizeMirrorResult =
  | { ok: true; host: string }
  | { ok: false; reason: MirrorRejectReason };

/**
 * Normalize free-form user input (bare host, full URL, with/without
 * scheme/port/path) into a canonical hostname suitable for
 * `*://host/*` + `*://*.host/*` match patterns.
 *
 * IDN input is punycoded by `URL` (`зеркало.рф` -> `xn--…`); we store and
 * display punycode only — honest about what's matched, and immune to
 * homoglyph confusion in the mirrors list.
 */
export function normalizeMirrorInput(raw: string): NormalizeMirrorResult {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return { ok: false, reason: 'empty' };
  // An explicit non-web scheme is a paste mistake, not a mirror.
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(trimmed) && !/^https?:\/\//.test(trimmed)) {
    return { ok: false, reason: 'scheme' };
  }
  let host: string;
  try {
    host = new URL(/^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  // FQDN trailing dot; leading `www.` (the `*.host` pattern covers www,
  // and stripping it additionally covers the apex).
  host = host.replace(/\.$/, '').replace(/^www\./, '');
  if (host.startsWith('[') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    return { ok: false, reason: 'ip' };
  }
  if (!host.includes('.')) return { ok: false, reason: 'no_dot' };
  if (host.length > 253 || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host)) {
    return { ok: false, reason: 'invalid' };
  }
  return { ok: true, host };
}

/**
 * Coerce an untrusted stored/imported value into a clean hosts list.
 * Accepts either the storage bag `{ hosts: [...] }` or a bare array
 * (export/import envelope field). Order-preserving.
 */
export function sanitizeMirrorList(raw: unknown): string[] {
  const arr =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as { hosts?: unknown }).hosts
      : raw;
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  for (const entry of arr) {
    if (out.length >= MAX_USER_MIRRORS) break;
    if (typeof entry !== 'string') continue;
    const norm = normalizeMirrorInput(entry);
    if (!norm.ok) continue;
    if (isCoveredByHostList(norm.host, BUILTIN_MIRROR_HOSTS)) continue;
    if (isCoveredByHostList(norm.host, out)) continue;
    out.push(norm.host);
  }
  return out;
}

export async function readUserMirrors(adapter: StorageAdapter): Promise<string[]> {
  return sanitizeMirrorList(await adapter.get<unknown>(MIRRORS_STORAGE_KEY, null));
}

export type AddMirrorResult =
  | { ok: true; host: string }
  | { ok: false; reason: MirrorRejectReason };

/**
 * Validate raw input and append it to the stored list. Does NOT touch
 * permissions or script registration — the background reconciles those
 * off `storage.onChanged`.
 */
export async function addUserMirror(
  adapter: StorageAdapter,
  rawInput: string,
): Promise<AddMirrorResult> {
  const norm = normalizeMirrorInput(rawInput);
  if (!norm.ok) return norm;
  if (isCoveredByHostList(norm.host, BUILTIN_MIRROR_HOSTS)) {
    return { ok: false, reason: 'builtin' };
  }
  const current = await readUserMirrors(adapter);
  if (isCoveredByHostList(norm.host, current)) return { ok: false, reason: 'duplicate' };
  if (current.length >= MAX_USER_MIRRORS) return { ok: false, reason: 'limit' };
  await adapter.set(MIRRORS_STORAGE_KEY, { hosts: [...current, norm.host] });
  return { ok: true, host: norm.host };
}

export async function removeUserMirror(adapter: StorageAdapter, host: string): Promise<void> {
  const current = await readUserMirrors(adapter);
  const next = current.filter((h) => h !== host);
  if (next.length === current.length) return;
  await adapter.set(MIRRORS_STORAGE_KEY, { hosts: next });
}

/** Replace the whole list (settings import). Returns the sanitized result. */
export async function replaceUserMirrors(
  adapter: StorageAdapter,
  rawHosts: unknown,
): Promise<string[]> {
  const next = sanitizeMirrorList(rawHosts);
  await adapter.set(MIRRORS_STORAGE_KEY, { hosts: next });
  return next;
}
