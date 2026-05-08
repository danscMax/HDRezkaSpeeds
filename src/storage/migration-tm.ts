/**
 * One-time best-effort import of legacy TM-userscript settings from page
 * localStorage.
 *
 * What this CAN read (audit C5, see docs/MIGRATION.md):
 *   - `<site>-speed-settings`   -> Settings JSON, normalised through the
 *                                  SettingsStore validator on next init.
 *   - `<site>-selected-speed`   -> the user's last-picked speed.
 *
 * What it CAN'T read:
 *   - GM-storage data (`GM_setValue` keys). The WebExtensions API has no
 *     bridge to userscript-manager storage. Recent userscript versions
 *     mirror to localStorage on every save, so users on a recent build
 *     are covered by this importer; older installs need the manual
 *     export/import flow added in Wave 1.8b.
 *
 * What it deliberately DOES NOT migrate (audit S18 + M1):
 *   - SelectorCache. The userscript stored cache as PER-KEY entries:
 *       `vs-cache:<host>:<selectorKey>`     (live entry)
 *       `vs-cache:backup:<host>:<selectorKey>` (rollback shadow)
 *     in GM-storage. The extension uses a different shape -- a
 *     PER-HOST-BAG single key:
 *       `vs-cache:<host>` -> { entries, backups }
 *     in `browser.storage.local`. The two namespaces don't overlap (page
 *     localStorage / GM-storage / extension storage are isolated), so
 *     even if both shapes exist on the same machine they can't poison
 *     each other. We choose NOT to translate one shape into the other:
 *     the cache is heuristic state tied to a specific SCRIPT_VERSION +
 *     DOM signature, and a cold start is safer than carrying over stale
 *     guesses across a project boundary.
 */

import type { Site } from '../app/ports';
import { storageKeysFor, TM_MIGRATION_FLAG } from '../config';
import type { SettingsStoreImpl } from './settings-store';
import type { SpeedStoreImpl } from './speed-store';
import type { Settings } from './types';

export interface TmMigrationResult {
  /** True when this run actually imported something (settings or speed). */
  imported: boolean;
  /** Names of the legacy keys that were found and merged. Useful for logs. */
  importedKeys: string[];
  /** Set when localStorage threw or returned a non-string for a key. */
  errors: string[];
}

/**
 * Run the importer if the marker isn't set yet, then mark.
 *
 * Returns a result describing what was imported. Safe to call on every
 * bootstrap -- the flag check makes subsequent runs no-ops.
 *
 * `settingsStore` and `speedStore` MUST already be `init()`-ed.
 */
export async function runTmMigration(
  site: Site,
  settingsStore: SettingsStoreImpl,
  speedStore: SpeedStoreImpl,
): Promise<TmMigrationResult> {
  const result: TmMigrationResult = {
    imported: false,
    importedKeys: [],
    errors: [],
  };

  if (settingsStore.getKey(TM_MIGRATION_FLAG as keyof Settings) === true) {
    return result; // already done on a prior run
  }

  try {
    const keys = storageKeysFor(site);

    // Settings
    const rawSettings = readLocalStorageSafely(keys.settings, result.errors);
    if (rawSettings != null) {
      try {
        const parsed = JSON.parse(rawSettings) as Partial<Settings>;
        if (parsed && typeof parsed === 'object') {
          // SettingsStore.update() merges the patch onto the live state and
          // re-validates each field (sliderPosition enum, hotkey shapes, etc.).
          await settingsStore.update(parsed);
          result.importedKeys.push(keys.settings);
        }
      } catch (e) {
        result.errors.push(`${keys.settings}: ${describeError(e)}`);
      }
    }

    // Selected speed (number or numeric string)
    const rawSpeed = readLocalStorageSafely(keys.speed, result.errors);
    if (rawSpeed != null) {
      const parsed = parseFloat(rawSpeed);
      if (Number.isFinite(parsed)) {
        try {
          await speedStore.setCurrent(parsed);
          result.importedKeys.push(keys.speed);
        } catch (e) {
          result.errors.push(`${keys.speed}: ${describeError(e)}`);
        }
      }
    }
  } finally {
    // Mark the run -- whether or not anything was imported, AND even if a
    // step above threw, we never want to probe page-localStorage again
    // for this site. Re-running could clobber post-install edits with
    // stale TM data on the next bootstrap. The flag-write itself is
    // best-effort: if storage is full or unavailable, the next bootstrap
    // will retry — which is the safer failure mode (vs silently double-
    // importing once storage recovers).
    try {
      await settingsStore.update({
        [TM_MIGRATION_FLAG]: true,
      } as unknown as Partial<Settings>);
    } catch (e) {
      result.errors.push(`flag: ${describeError(e)}`);
    }
  }

  result.imported = result.importedKeys.length > 0;
  return result;
}

function readLocalStorageSafely(key: string, errors: string[]): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  } catch (e) {
    // Some sites or sandboxed iframes throw on `localStorage` access
    // (SecurityError). Treat as absent and remember for diagnostics.
    errors.push(`${key} read: ${describeError(e)}`);
    return null;
  }
}

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
