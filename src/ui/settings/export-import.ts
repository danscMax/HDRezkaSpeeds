/**
 * Settings JSON export / import (audit C5 workaround for GM-storage).
 *
 * Userscripts that stored data only in GM-storage can't be migrated
 * automatically -- the WebExtensions API has no bridge there. We give the
 * user a manual escape hatch: dump the live SettingsStore as a JSON file
 * they can re-import in any browser/extension copy.
 *
 * No DOM dependency on a specific shape; the host module wires whichever
 * buttons trigger these.
 */

import type { AppContext } from '../../app/context';
import type { Settings } from '../../storage/types';
import { safeJsonParse } from '../../utils/safe-json';

const FILENAME_PREFIX = 'hdrezka-speeds-settings';

export interface ExportEnvelope {
  type: 'hdrezka-speeds-settings' | 'video-speeds-settings';
  version: 1;
  exportedAt: string;
  site: string;
  settings: Partial<Settings>;
}

export function buildExportEnvelope(ctx: AppContext): ExportEnvelope {
  // Strip the TM-migration flag before export. Otherwise re-importing the
  // file on a fresh extension install poisons the migration state -- the
  // import sets `__migrated_from_tm: true` and the next bootstrap skips
  // the page-localStorage scan, so any TM data the user wanted picked up
  // is silently ignored (audit M13).
  const { __migrated_from_tm: _migrated, ...exportable } = ctx.settingsStore.get();
  void _migrated;
  return {
    type: 'hdrezka-speeds-settings',
    version: 1,
    exportedAt: new Date().toISOString(),
    site: ctx.site,
    settings: exportable,
  };
}

/**
 * Trigger a file download with the current settings serialised as JSON.
 * Filename includes the site + ISO date so users can keep multiple snapshots.
 */
export function exportSettingsToFile(ctx: AppContext): void {
  const env = buildExportEnvelope(ctx);
  const json = JSON.stringify(env, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${FILENAME_PREFIX}-${ctx.site}-${todayIso()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click handler fires; small delay so the browser has
  // time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface ImportResult {
  ok: boolean;
  message?: string;
}

/**
 * Parse a user-supplied JSON file and merge its `settings` object into the
 * SettingsStore. Returns `{ok, message}` so the host can show a toast.
 *
 * Accepts both our own envelope shape and a bare userscript-style settings
 * object (where the userscript exported its raw settings as JSON without a
 * wrapper). The SettingsStore validator filters out unknown / malformed
 * fields per-key.
 */
export async function importSettingsFromText(ctx: AppContext, text: string): Promise<ImportResult> {
  const parsed = safeJsonParse<unknown>(text, null);
  if (!parsed) {
    return { ok: false, message: 'invalid JSON' };
  }

  let patch: Partial<Settings> | null = null;
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    ((parsed as { type?: unknown }).type === 'hdrezka-speeds-settings' ||
      (parsed as { type?: unknown }).type === 'video-speeds-settings') &&
    typeof (parsed as { settings?: unknown }).settings === 'object'
  ) {
    patch = (parsed as ExportEnvelope).settings;
  } else if (typeof parsed === 'object' && parsed !== null) {
    // Bare settings object (legacy userscript export).
    patch = parsed as Partial<Settings>;
  }

  if (!patch) return { ok: false, message: 'unrecognized shape' };

  // Always strip the TM-migration flag from imported data. The flag is
  // an internal marker for "page localStorage already scanned"; it must
  // not be transferred across installs (audit M13 -- defense-in-depth
  // against legacy export files written before buildExportEnvelope was
  // taught to strip it). The destination's bootstrap decides whether
  // to migrate based on its OWN flag state.
  if (patch && typeof patch === 'object') {
    const cleaned = { ...patch } as Partial<Settings>;
    delete cleaned.__migrated_from_tm;
    patch = cleaned;
  }

  try {
    await ctx.settingsStore.update(patch);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Open the OS file picker, read the chosen file, and import.
 * The picker is hidden in the DOM and removed after click.
 */
export function openImportPicker(ctx: AppContext, onResult: (r: ImportResult) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.style.display = 'none';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) {
      onResult({ ok: false, message: 'no file selected' });
      input.remove();
      return;
    }
    try {
      const text = await file.text();
      const result = await importSettingsFromText(ctx, text);
      onResult(result);
    } catch (e) {
      onResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      input.remove();
    }
  });
  document.body.appendChild(input);
  input.click();
}

function todayIso(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
