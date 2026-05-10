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
  /**
   * Subscribe to state changes. Fires when EXTERNAL writes (e.g. popup
   * mutating settingsStore directly) change the persisted healing flags.
   * Does NOT fire on local setDiscoveryEnabled / setHealthCheckEnabled
   * calls — those go through `persist()` and the caller already knows.
   * Returns an unsubscribe function.
   */
  subscribe(fn: (s: KillSwitchSnapshot) => void): () => void;
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

  // Audit 2026-05-09 M1: cross-instance propagation. The popup can write
  // healing.* through the same SettingsStore (or a future options page);
  // without this subscriber the active content-script kept its cached
  // boolean forever and the user had to reload the page for the toggle
  // to take effect. Refresh local state from every store change.
  const offSub = ctx.settingsStore.subscribe((next) => {
    const live = (next as unknown as Record<string, unknown>).healing;
    const persisted: PersistedShape =
      live && typeof live === 'object' ? (live as PersistedShape) : {};
    const incoming: KillSwitchSnapshot = {
      discoveryEnabled: persisted.discoveryEnabled !== false,
      healthCheckEnabled: persisted.healthCheckEnabled !== false,
    };
    if (
      incoming.discoveryEnabled !== state.discoveryEnabled ||
      incoming.healthCheckEnabled !== state.healthCheckEnabled
    ) {
      state = incoming;
      // Notify external listeners (e.g. HealthChecker) so they can
      // start/stop polling on the fly instead of waiting for next tick.
      for (const fn of [...listeners]) {
        try {
          fn(state);
        } catch (e) {
          ctx.logger.warn('KillSwitch: listener threw', e);
        }
      }
    }
  });
  ctx.cleanup.add(offSub);

  // External listeners (HealthChecker subscribes to re-arm itself when
  // healthCheckEnabled flips back on — audit M2).
  const listeners = new Set<(s: KillSwitchSnapshot) => void>();

  async function persist(patch: Partial<KillSwitchSnapshot>): Promise<void> {
    // Optimistic in-memory update so isHealthCheckEnabled() reads the new
    // value immediately. Reverted below if the disk write rejects, so
    // memory and disk stay in sync — the previous code left memory ahead
    // of disk, which silently undid user toggles on the next page load.
    const prev = state;
    state = { ...state, ...patch };
    const live = (ctx.settingsStore.get() as unknown as Record<string, unknown>).healing;
    const merged = { ...(typeof live === 'object' && live ? live : {}), ...patch };
    // Use the store's update so subscribers get notified, even though
    // `healing` isn't a declared field. The validator in Wave 1.4 ignores
    // unknown fields on init, but update() merges them as-is.
    try {
      await ctx.settingsStore.update({ healing: merged } as never);
    } catch (e) {
      state = prev;
      ctx.logger.warn('KillSwitch: persist rejected, reverting in-memory state', e);
      throw e;
    }
  }

  return {
    isDiscoveryEnabled: () => state.discoveryEnabled,
    isHealthCheckEnabled: () => state.healthCheckEnabled,
    setDiscoveryEnabled: (on) => persist({ discoveryEnabled: on }),
    setHealthCheckEnabled: (on) => persist({ healthCheckEnabled: on }),
    trip: () => persist({ discoveryEnabled: false, healthCheckEnabled: false }),
    snapshot: () => ({ ...state }),
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
