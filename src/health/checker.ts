/**
 * HealthChecker -- watchdog that runs the report builder on a schedule and
 * fires a one-shot recovery attempt when the page goes from healthy to
 * unhealthy.
 *
 * Schedule:
 *   - First run 5s after start() (warmup window so we don't catch a
 *     half-bootstrapped page).
 *   - Then poll every 30s for the rest of the page lifetime.
 *   - Auto-recovery fires on the healthy → unhealthy transition; the
 *     reverse transition is logged but doesn't stop the watchdog.
 *
 * Earlier behaviour stopped the poll the moment the first check passed,
 * which left the watchdog blind to any degradation that happened after
 * the warmup. Now we keep watching so the gear's red dot lights up
 * whenever the page actually breaks, not just at the 5s mark.
 *
 * All timers go through ctx.cleanup so the registry tears them down on
 * dispose (audit C3).
 */

import type { SelectorCacheImpl } from '../discovery/cache';
import { buildReport, type ReportDeps } from './report';
import type { DiagnosticReport, HealthChecks } from './types';

const FIRST_RUN_MS = 5_000;
const POLL_MS = 30_000;

/**
 * Auto-trip threshold. After this many consecutive unhealthy reports
 * (≈ AUTO_TRIP × POLL_MS = 150s of continuous failure), the checker fires
 * the `onConsecutiveFailures` callback once. The bootstrap typically uses
 * that callback to flip the kill-switch, halting the runaway purge ↔
 * re-add ↔ purge loop that occurred before this guard existed.
 */
const AUTO_TRIP_AFTER_N_FAILURES = 5;

export interface HealthChecker {
  start(): void;
  stop(): void;
  runOnce(): DiagnosticReport;
  getLastReport(): DiagnosticReport | null;
  isHealthy(): boolean;
  subscribe(fn: (r: DiagnosticReport) => void): () => void;
}

export interface CreateHealthCheckerDeps extends ReportDeps {
  /** Cache used by the auto-recovery branch to purge bad heuristic entries. */
  selectorCache: SelectorCacheImpl;
  /** Lets the checker silence itself when KillSwitch flips. */
  isHealthCheckEnabled: () => boolean;
  /**
   * Optional auto-trip callback. Fires exactly once per HealthChecker
   * lifetime, after AUTO_TRIP_AFTER_N_FAILURES consecutive unhealthy
   * reports. Bootstrap wires this to KillSwitch.setHealthCheckEnabled(false)
   * so a chronically broken page stops the purge-storm and surfaces the
   * gear's red dot for the user to act on manually.
   */
  onConsecutiveFailures?: (count: number) => void;
  /**
   * Optional handle that exposes a `subscribe()` to KillSwitch state
   * changes. When provided, the checker uses it to re-arm itself if
   * health-check transitions false → true after bootstrap (audit M2).
   * Without it, a user toggling health-check back on requires a reload.
   */
  killSwitchHandle?: {
    subscribe(fn: (s: { healthCheckEnabled: boolean }) => void): () => void;
  };
}

export function createHealthChecker(deps: CreateHealthCheckerDeps): HealthChecker {
  const { ctx, selectorCache } = deps;
  let lastReport: DiagnosticReport | null = null;
  let lastHealthy = true;
  let consecutiveFailures = 0;
  let autoTripped = false;
  const subscribers = new Set<(r: DiagnosticReport) => void>();
  let pollIntervalId: ReturnType<typeof setInterval> | null = null;
  let started = false;

  function notify(report: DiagnosticReport): void {
    for (const fn of subscribers) {
      try {
        fn(report);
      } catch (e) {
        // One subscriber crashing must not stop the others, but a silent
        // swallow used to hide rerender bugs and stale-data symptoms.
        ctx.logger.warn('HealthChecker: subscriber threw', e);
      }
    }
  }

  function tryAutoRecovery(checks: HealthChecks): void {
    try {
      // 1) Container missing AND infoElem cache came from heuristic? Drop it
      //    so next resolve walks the full chain again.
      if (!checks.container_inserted) {
        const ic = selectorCache.get('infoElem');
        if (ic?.source === 'heuristic') {
          selectorCache.purge('infoElem');
          ctx.logger.warn('HealthChecker: infoElem heuristic cache purged');
        }
      }
      // 2) Rate-resets storm AND video came from a soft strategy? Same.
      if (checks.ratechange_revert_per_minute > 10) {
        const vc = selectorCache.get('video');
        if (vc && (vc.source === 'heuristic' || vc.source === 'ancestor')) {
          selectorCache.purge('video');
          ctx.logger.warn('HealthChecker: video cache purged due to revert storm');
        }
      }
    } catch (e) {
      ctx.logger.error('HealthChecker auto-recovery failed', e);
    }
  }

  /** Internal — runs report + side effects + notify. Used by start() /
   *  startPolling() only. */
  function run(): DiagnosticReport {
    const report = buildReport(deps);
    lastReport = report;

    if (!report.healthy && lastHealthy) {
      ctx.logger.warn('HealthChecker: unhealthy state detected, attempting auto-recovery');
      tryAutoRecovery(report.checks);
    } else if (report.healthy && !lastHealthy) {
      ctx.logger.info('HealthChecker: recovered to healthy');
    }
    lastHealthy = report.healthy;

    if (report.healthy) {
      consecutiveFailures = 0;
      // Audit 2026-05-09 MAJOR: clear the auto-trip latch after sustained
      // recovery so a second wave of failures can trip again. Previously
      // autoTripped was a one-shot for the entire page lifetime — once
      // tripped, the user could re-enable health-check in settings but
      // the trip would never fire again on the next breakage.
      if (autoTripped) {
        autoTripped = false;
        ctx.logger.info('HealthChecker: auto-trip latch cleared after recovery');
      }
    } else {
      consecutiveFailures++;
      if (consecutiveFailures >= AUTO_TRIP_AFTER_N_FAILURES && !autoTripped) {
        autoTripped = true;
        ctx.logger.warn(
          `HealthChecker: ${consecutiveFailures} consecutive unhealthy reports, auto-tripping`,
        );
        try {
          deps.onConsecutiveFailures?.(consecutiveFailures);
        } catch (e) {
          ctx.logger.error('HealthChecker onConsecutiveFailures threw', e);
        }
      }
    }

    notify(report);
    return report;
  }

  /** Public read-only --  builds a report on demand but does NOT
   *  notify subscribers and does NOT trigger auto-recovery. The settings
   *  modal's diag tab calls this on every rerender; if it ran the full
   *  pipeline it would notify the panel.rerenderSettings subscriber and
   *  recurse back into rerender, freezing the page.
   *
   *  Audit 2026-05-09 MAJOR-races: do NOT mutate `lastHealthy`. The
   *  previous version overwrote it, which killed the next transition
   *  detection inside `run()` (the unhealthy → healthy / healthy →
   *  unhealthy edge that drives auto-recovery + the "purge bad heuristic"
   *  branch). Strictly read-only now. */
  function runOnce(): DiagnosticReport {
    const report = buildReport(deps);
    lastReport = report;
    return report;
  }

  function start(): void {
    if (started) return;
    if (!deps.isHealthCheckEnabled()) {
      // Audit 2026-05-09 M2: kill-switch was OFF at bootstrap, so we
      // don't arm now — but DO listen for it flipping back ON so the
      // checker re-arms without requiring a page reload. Previously
      // `start()` returned silently and the checker stayed dead until
      // reload.
      armReEnableWatcher();
      return;
    }
    started = true;

    // First check runs after the warmup window; polling is unconditional
    // afterwards so we keep catching late-onset degradation.
    ctx.cleanup.setTimeout(() => {
      run();
      startPolling();
    }, FIRST_RUN_MS);
  }

  // M2: subscribes to killSwitch (or polls deps.isHealthCheckEnabled
  // when no subscribe is available). The watcher tears itself down
  // after the first false→true transition by calling start() and
  // unsubscribing.
  function armReEnableWatcher(): void {
    const ks = deps.killSwitchHandle;
    if (!ks?.subscribe) return; // older deps shape — no watcher available
    const off = ks.subscribe((snap) => {
      if (snap.healthCheckEnabled && !started) {
        off();
        start();
      }
    });
    ctx.cleanup.add(off);
  }

  function startPolling(): void {
    if (pollIntervalId !== null) return;
    pollIntervalId = ctx.cleanup.setInterval(() => {
      if (!deps.isHealthCheckEnabled()) {
        // Audit 2026-05-11 W1.2 (REL-002): auto-trip path must reset
        // started + re-arm the watcher so user re-enable resumes
        // polling. Previously stopPolling() alone left started=true
        // and no watcher → checker dead until page reload.
        stop();
        armReEnableWatcher();
        return;
      }
      // Skip the tick when the tab is hidden. Background tabs don't need
      // a fresh diagnostic — the user can't see the gear-warning dot, and
      // the next visible tick (Chrome resumes intervals on tab show) will
      // catch any degradation that happened while invisible.
      if (typeof document !== 'undefined' && document.hidden) return;
      run();
    }, POLL_MS);
  }

  function stopPolling(): void {
    if (pollIntervalId !== null) {
      clearInterval(pollIntervalId);
      pollIntervalId = null;
    }
  }

  function stop(): void {
    started = false;
    stopPolling();
  }

  return {
    start,
    stop,
    runOnce,
    getLastReport: () => lastReport,
    isHealthy: () => lastHealthy,
    subscribe: (fn) => {
      subscribers.add(fn);
      if (lastReport) fn(lastReport);
      return () => {
        subscribers.delete(fn);
      };
    },
  };
}
