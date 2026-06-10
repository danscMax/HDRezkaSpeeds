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
  // Audit 2026-05-11 W1.3 (SEC2-001): `healing` is now a declared
  // Settings field (typed in storage/types.ts). Read it directly; the
  // optional shape gives us safe defaults ({true,true}) when nothing
  // has been persisted yet.
  function read(): PersistedShape {
    return ctx.settingsStore.get().healing ?? {};
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
    const persisted: PersistedShape = next.healing ?? {};
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
    const live = ctx.settingsStore.get().healing;
    const merged = { ...(live ?? {}), ...patch };
    // Audit 2026-05-11 W1.3 (SEC2-001): `healing` is now a declared
    // Settings field with its own sub-validator in sanitizePatch — the
    // patch reaches disk and survives page reloads. Previously the
    // sanitizer dropped it silently, breaking defense-in-depth toggles.
    try {
      await ctx.settingsStore.update({ healing: merged });
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
