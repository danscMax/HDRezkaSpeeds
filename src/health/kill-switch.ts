/**
 * KillSwitch -- two boolean flags that gate "self-healing" behaviors.
 *
 * `discoveryEnabled` -- when false, DiscoveryEngine stops at strategy 2
 *                       (exact selectors). Disables substring/ancestor/
 *                       heuristic. Lets the user shut off auto-recovery
 *                       if a wrong cache keeps poisoning the panel.
 * `healthCheckEnabled` -- when false, HealthChecker stops collecting
 *                         reports. The diagnostics tab still renders the
 *                         last collected report; just no new ones.
 *
 * Lives next to HealthChecker because the checker reads it on every tick
 * and the user-facing toggles in the Settings modal also write through
 * here. Persistence is via SettingsStore (audit C2 -- everything in one
 * place).
 */

import type { AppContext } from '../app/context';
import type { KillSwitchSnapshot } from './types';

export interface KillSwitch {
  isDiscoveryEnabled(): boolean;
  isHealthCheckEnabled(): boolean;
  setDiscoveryEnabled(on: boolean): Promise<void>;
  setHealthCheckEnabled(on: boolean): Promise<void>;
  /** Engage the kill-switch (disable both halves) for a hard stop. */
  trip(): Promise<void>;
  snapshot(): KillSwitchSnapshot;
}

interface PersistedShape {
  discoveryEnabled?: boolean;
  healthCheckEnabled?: boolean;
}

export function createKillSwitch(ctx: AppContext): KillSwitch {
  // Settings.healing isn't a declared field on Settings (we don't persist
  // KillSwitch state by default; defaults to {true,true}). Read defensively
  // through the store; if the field is missing we use defaults.
  function read(): PersistedShape {
    const raw = (ctx.settingsStore.get() as unknown as Record<string, unknown>).healing;
    if (raw && typeof raw === 'object') return raw as PersistedShape;
    return {};
  }

  let state: KillSwitchSnapshot = {
    discoveryEnabled: read().discoveryEnabled !== false,
    healthCheckEnabled: read().healthCheckEnabled !== false,
  };

  async function persist(patch: Partial<KillSwitchSnapshot>): Promise<void> {
    state = { ...state, ...patch };
    const live = (ctx.settingsStore.get() as unknown as Record<string, unknown>).healing;
    const merged = { ...(typeof live === 'object' && live ? live : {}), ...patch };
    // Use the store's update so subscribers get notified, even though
    // `healing` isn't a declared field. The validator in Wave 1.4 ignores
    // unknown fields on init, but update() merges them as-is.
    await ctx.settingsStore.update({ healing: merged } as never);
  }

  return {
    isDiscoveryEnabled: () => state.discoveryEnabled,
    isHealthCheckEnabled: () => state.healthCheckEnabled,
    setDiscoveryEnabled: (on) => persist({ discoveryEnabled: on }),
    setHealthCheckEnabled: (on) => persist({ healthCheckEnabled: on }),
    trip: () => persist({ discoveryEnabled: false, healthCheckEnabled: false }),
    snapshot: () => ({ ...state }),
  };
}
