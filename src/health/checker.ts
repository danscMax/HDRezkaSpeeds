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

import type { AppContext } from '../app/context';
import type { SelectorCacheImpl } from '../discovery/cache';
import { buildReport, type ReportDeps } from './report';
import type { DiagnosticReport, HealthChecks } from './types';

const FIRST_RUN_MS = 5_000;
const POLL_MS = 30_000;

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
}

export function createHealthChecker(deps: CreateHealthCheckerDeps): HealthChecker {
  const { ctx, selectorCache } = deps;
  let lastReport: DiagnosticReport | null = null;
  let lastHealthy = true;
  const subscribers = new Set<(r: DiagnosticReport) => void>();
  let pollIntervalId: ReturnType<typeof setInterval> | null = null;
  let started = false;

  function notify(report: DiagnosticReport): void {
    for (const fn of subscribers) {
      try { fn(report); } catch { /* swallow */ }
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

    notify(report);
    return report;
  }

  /** Public read-only --  builds a report on demand but does NOT
   *  notify subscribers and does NOT trigger auto-recovery. The settings
   *  modal's diag tab calls this on every rerender; if it ran the full
   *  pipeline it would notify the panel.rerenderSettings subscriber and
   *  recurse back into rerender, freezing the page. */
  function runOnce(): DiagnosticReport {
    const report = buildReport(deps);
    lastReport = report;
    lastHealthy = report.healthy;
    return report;
  }

  function start(): void {
    if (started || !deps.isHealthCheckEnabled()) return;
    started = true;

    // First check runs after the warmup window; polling is unconditional
    // afterwards so we keep catching late-onset degradation.
    ctx.cleanup.setTimeout(() => {
      run();
      startPolling();
    }, FIRST_RUN_MS);
  }

  function startPolling(): void {
    if (pollIntervalId !== null) return;
    pollIntervalId = ctx.cleanup.setInterval(() => {
      if (!deps.isHealthCheckEnabled()) {
        stopPolling();
        return;
      }
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
      return () => { subscribers.delete(fn); };
    },
  };
}
