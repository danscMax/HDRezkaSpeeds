import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../src/app/context';
import { defaultSettings, type Settings } from '../../src/storage/types';
import { buildExportEnvelope, importSettingsFromText } from '../../src/ui/settings/export-import';

/** Minimal AppContext stub: export/import only touch settingsStore + site. */
function makeCtx(): { ctx: AppContext; update: ReturnType<typeof vi.fn> } {
  const settings: Settings = { ...defaultSettings('en'), __migrated_from_tm: true };
  const update = vi.fn(async (_patch: Partial<Settings>) => {});
  const ctx = {
    site: 'hdrezka',
    settingsStore: {
      get: () => settings,
      update,
    },
  } as unknown as AppContext;
  return { ctx, update };
}

describe('buildExportEnvelope + userMirrors (0.5.0)', () => {
  it('includes the mirror list when provided', () => {
    const { ctx } = makeCtx();
    const env = buildExportEnvelope(ctx, ['new-rezka.tv', 'other.example']);
    expect(env.userMirrors).toEqual(['new-rezka.tv', 'other.example']);
    // Still strips the TM flag from settings (audit M13).
    expect(env.settings).not.toHaveProperty('__migrated_from_tm');
  });

  it('omits the field when the list is empty or absent', () => {
    const { ctx } = makeCtx();
    expect(buildExportEnvelope(ctx)).not.toHaveProperty('userMirrors');
    expect(buildExportEnvelope(ctx, [])).not.toHaveProperty('userMirrors');
  });
});

describe('importSettingsFromText + userMirrors (0.5.0)', () => {
  function envelopeJson(extra: Record<string, unknown> = {}): string {
    return JSON.stringify({
      type: 'hdrezka-speeds-settings',
      version: 1,
      exportedAt: '2026-06-10T00:00:00.000Z',
      site: 'hdrezka',
      settings: { rememberSpeed: false },
      ...extra,
    });
  }

  it('passes the envelope mirror list to applyMirrors after the settings patch', async () => {
    const { ctx, update } = makeCtx();
    const applyMirrors = vi.fn(async (_hosts: unknown) => {});
    const res = await importSettingsFromText(
      ctx,
      envelopeJson({ userMirrors: ['new-rezka.tv'] }),
      applyMirrors,
    );
    expect(res.ok).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    expect(applyMirrors).toHaveBeenCalledWith(['new-rezka.tv']);
  });

  it('back-compat: old envelopes without the field never call applyMirrors', async () => {
    const { ctx } = makeCtx();
    const applyMirrors = vi.fn(async (_hosts: unknown) => {});
    const res = await importSettingsFromText(ctx, envelopeJson(), applyMirrors);
    expect(res.ok).toBe(true);
    expect(applyMirrors).not.toHaveBeenCalled();
  });

  it('ignores a non-array userMirrors field', async () => {
    const { ctx } = makeCtx();
    const applyMirrors = vi.fn(async (_hosts: unknown) => {});
    const res = await importSettingsFromText(
      ctx,
      envelopeJson({ userMirrors: 'new-rezka.tv' }),
      applyMirrors,
    );
    expect(res.ok).toBe(true);
    expect(applyMirrors).not.toHaveBeenCalled();
  });

  it('imports cleanly when no applier is wired (userscript surface)', async () => {
    const { ctx } = makeCtx();
    const res = await importSettingsFromText(ctx, envelopeJson({ userMirrors: ['x.example'] }));
    expect(res.ok).toBe(true);
  });

  it('does not apply mirrors from a bare (non-envelope) settings object', async () => {
    const { ctx } = makeCtx();
    const applyMirrors = vi.fn(async (_hosts: unknown) => {});
    const res = await importSettingsFromText(
      ctx,
      JSON.stringify({ rememberSpeed: true, userMirrors: ['x.example'] }),
      applyMirrors,
    );
    expect(res.ok).toBe(true);
    expect(applyMirrors).not.toHaveBeenCalled();
  });
});
