/**
 * Last host where bootstrap successfully activated ("last-known-good
 * mirror"). Written by the content script on every successful bootstrap;
 * read by the popup's "Open HDRezka" action so it can navigate straight to
 * the domain the user last watched on — the freshest signal we have when no
 * rezka tab is open.
 *
 * Stored under its own key (NOT the settings blob) so this per-page-load
 * write never notifies settings subscribers / triggers a panel rerender.
 */

import type { StorageAdapter } from './adapter';
import { normalizeMirrorInput } from './mirrors-store';

export const LAST_HOST_STORAGE_KEY = 'hdrezka-last-host';

/** Read the stored last-known-good host, or null if unset / invalid. */
export async function readLastWorkingHost(adapter: StorageAdapter): Promise<string | null> {
  const raw = await adapter.get<unknown>(LAST_HOST_STORAGE_KEY, null);
  if (typeof raw !== 'string') return null;
  const norm = normalizeMirrorInput(raw);
  return norm.ok ? norm.host : null;
}

/** Persist `host` as the last-known-good mirror. Silently ignores junk. */
export async function writeLastWorkingHost(adapter: StorageAdapter, host: string): Promise<void> {
  const norm = normalizeMirrorInput(host);
  if (!norm.ok) return;
  await adapter.set(LAST_HOST_STORAGE_KEY, norm.host);
}
