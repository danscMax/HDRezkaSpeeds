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
  /** User-defined mirror hosts (0.5.0). Sibling of `settings` — NOT a
   *  Settings key: the list lives under its own storage key and the
   *  host permissions backing it can't travel in a JSON file anyway
   *  (re-granted via the popup after import). Absent in older exports. */
  userMirrors?: string[];
}

export function buildExportEnvelope(
  ctx: AppContext,
  userMirrors?: readonly string[],
): ExportEnvelope {
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
    ...(userMirrors && userMirrors.length > 0 ? { userMirrors: [...userMirrors] } : {}),
  };
}

/**
 * Trigger a file download with the current settings serialised as JSON.
 * Filename includes the site + ISO date so users can keep multiple snapshots.
 */
export function exportSettingsToFile(ctx: AppContext, userMirrors?: readonly string[]): void {
  const env = buildExportEnvelope(ctx, userMirrors);
  const json = JSON.stringify(env, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  // Audit 2026-05-09 Q3: detached anchor — no host-page DOM mutation.
  const a = document.createElement('a');
  a.href = url;
  a.download = `${FILENAME_PREFIX}-${ctx.site}-${todayIso()}.json`;
  a.dispatchEvent(new MouseEvent('click', { bubbles: false, cancelable: true }));
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface ImportResult {
  ok: boolean;
  message?: string;
  /** UX-032: the user declined the pre-apply preview — not an error. */
  cancelled?: boolean;
}

/**
 * Parse a user-supplied JSON file and merge its `settings` object into the
 * SettingsStore. Returns `{ok, message}` so the host can show a toast.
 *
 * Accepts both our own envelope shape and a bare userscript-style settings
 * object. The SettingsStore validator filters out unknown / malformed
 * fields per-key (`sanitizePatch` in settings-store.ts — proto-pollution
 * guards + per-field type checks).
 *
 * Audit 2026-05-09 sec C5: belt-and-suspenders boundary defence — strip
 * `__proto__`/`constructor`/`prototype` at the import boundary too, and
 * reject patches whose recognised-key count is zero.
 */
const KNOWN_SETTINGS_KEYS: ReadonlyArray<keyof Settings> = [
  'sliderPosition',
  'rememberSpeed',
  'language',
  'hotkeys',
  'speedPresets',
  'speedStep',
  'sliderMin',
  'sliderMax',
  'lastSeenTheme',
];

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function sanitizeImportPatch(raw: unknown): Partial<Settings> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, unknown> = Object.create(null);
  let recognised = 0;
  for (const k of Object.keys(raw as object)) {
    if (DANGEROUS_KEYS.has(k)) continue;
    if (k === '__migrated_from_tm') continue;
    if ((KNOWN_SETTINGS_KEYS as readonly string[]).includes(k)) {
      out[k] = (raw as Record<string, unknown>)[k];
      recognised++;
    }
  }
  if (recognised === 0) return null;
  return out as Partial<Settings>;
}

export async function importSettingsFromText(
  ctx: AppContext,
  text: string,
  applyMirrors?: (hosts: unknown) => Promise<void>,
  /** UX-032: optional pre-apply gate. Receives a human-readable summary
   *  of what's about to change; returning false aborts the import.
   *  Interactive surfaces pass a window.confirm wrapper; programmatic
   *  callers (tests, migrations) omit it and apply directly. */
  confirmApply?: (summary: string) => boolean,
): Promise<ImportResult> {
  const parsed = safeJsonParse<unknown>(text, null);
  if (!parsed) {
    return { ok: false, message: 'invalid JSON' };
  }

  let raw: unknown = null;
  let isEnvelope = false;
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    ((parsed as { type?: unknown }).type === 'hdrezka-speeds-settings' ||
      (parsed as { type?: unknown }).type === 'video-speeds-settings') &&
    typeof (parsed as { settings?: unknown }).settings === 'object'
  ) {
    raw = (parsed as ExportEnvelope).settings;
    isEnvelope = true;
  } else if (typeof parsed === 'object' && parsed !== null) {
    raw = parsed;
  }

  const patch = sanitizeImportPatch(raw);
  if (!patch) return { ok: false, message: 'unrecognized shape or no valid keys' };

  // UX-032: show what's about to change BEFORE applying. Previously the
  // file was applied the instant the picker closed — no way to back out
  // of importing the wrong snapshot.
  if (confirmApply) {
    const mirrorsRawPreview = isEnvelope ? (parsed as ExportEnvelope).userMirrors : undefined;
    const previewLines = [ctx.i18n.t('import.preview.header'), ''];
    previewLines.push(
      ctx.i18n.t('import.preview.line.settings', { count: Object.keys(patch).length }),
    );
    if (Array.isArray(patch.speedPresets)) {
      previewLines.push(
        ctx.i18n.t('import.preview.line.presets', { count: patch.speedPresets.length }),
      );
    }
    if (patch.hotkeys && typeof patch.hotkeys === 'object') {
      const hk = patch.hotkeys as { speedUp?: unknown[]; speedDown?: unknown[] };
      const combos = (hk.speedUp?.length ?? 0) + (hk.speedDown?.length ?? 0);
      if (combos > 0) {
        previewLines.push(ctx.i18n.t('import.preview.line.hotkeys', { count: combos }));
      }
    }
    if (Array.isArray(mirrorsRawPreview) && mirrorsRawPreview.length > 0) {
      previewLines.push(
        ctx.i18n.t('import.preview.line.mirrors', { count: mirrorsRawPreview.length }),
      );
    }
    if (!confirmApply(previewLines.join('\n'))) {
      return { ok: false, cancelled: true };
    }
  }

  try {
    await ctx.settingsStore.update(patch);
    // Restore the user-mirror list when the envelope carries one and the
    // surface provided an applier (sanitization happens inside it via
    // sanitizeMirrorList). REPLACE semantics: an import is a snapshot
    // restore; the background revokes permissions of dropped hosts off
    // the storage diff. Imported hosts land permission-pending — the
    // popup's badges + grant buttons guide the user from there.
    if (isEnvelope && applyMirrors) {
      const mirrorsRaw = (parsed as ExportEnvelope).userMirrors;
      if (Array.isArray(mirrorsRaw)) {
        await applyMirrors(mirrorsRaw);
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Open the OS file picker, read the chosen file, and import.
 * The picker is hidden in the DOM and removed after click.
 */
export function openImportPicker(
  ctx: AppContext,
  onResult: (r: ImportResult) => void,
  applyMirrors?: (hosts: unknown) => Promise<void>,
): void {
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
      // Interactive surface — gate the apply behind a native confirm
      // with the summary (UX-032).
      const confirmApply =
        typeof window !== 'undefined' && typeof window.confirm === 'function'
          ? (summary: string) => window.confirm(summary)
          : undefined;
      const result = await importSettingsFromText(ctx, text, applyMirrors, confirmApply);
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
