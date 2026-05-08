/**
 * DiagnosticReport builder -- snapshots the live state of every subsystem
 * we care about into a JSON-serialisable bag.
 *
 * Kept dependency-light: receives discovery/cache/meter through deps so
 * health/ stays out of the import graph for those features (audit H2 --
 * the original userscript had health -> discovery -> kill-switch ->
 * settings -> health cycles; the deps-injection cuts them).
 *
 * Ported from .user.js:5125-5249.
 */

import type { AppContext } from '../app/context';
import type { DiscoveryEngineImpl } from '../discovery/engine';
import type { DiscoveryMetrics, SelectorKey } from '../discovery/types';
import { Validators } from '../discovery/validators';
import type { RatechangeMeter } from '../speed/meter';
import type { DiagnosticReport, HealthChecks, KillSwitchSnapshot } from './types';

export interface ReportDeps {
  ctx: AppContext;
  scriptVersion: string;
  discovery: DiscoveryEngineImpl;
  meter: RatechangeMeter;
  killSwitch: () => KillSwitchSnapshot;
  /** Selector that finds the panel root in the page; defaults to the
   *  class `.vs-panel` emitted by ui/panel.ts. */
  panelSelector?: string;
}

const PANEL_SEL = '.vs-panel';

/**
 * Compute a fresh report. Cheap (~few ms): every probe is sync against the
 * live DOM + already-hydrated stores.
 */
export function buildReport(deps: ReportDeps): DiagnosticReport {
  const checks = buildChecks(deps);
  const issues = enumerateIssues(checks, deps.ctx);
  const isWaiting = checks.video_found && !checks.playback_started && structuralOk(checks);
  const healthy = computeHealthy(checks, isWaiting);

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    script_version: deps.scriptVersion,
    site: deps.ctx.site,
    hostname: safeHostname(),
    url_redacted: redactUrl(),
    user_agent: navigator.userAgent,
    language: navigator.language,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    healthy,
    isWaiting,
    checks,
    ratechange_log_tail: deps.meter.tail(20),
    discovery: deps.discovery.metrics() as DiscoveryMetrics,
    kill_switch: deps.killSwitch(),
    issues,
    lastCheckTime: new Date().toLocaleTimeString(),
  };
}

function buildChecks(deps: ReportDeps): HealthChecks {
  const { ctx, discovery, meter } = deps;
  const panelSel = deps.panelSelector ?? PANEL_SEL;

  const videoEl = ctx.discovery.resolve('video') as HTMLVideoElement | null;
  // Skip cache for the structural probes -- the report should reflect the
  // live DOM, not what we cached before the page reflowed.
  const playerR = discovery.resolve('playerContainer', { skipCache: true });
  const infoR = discovery.resolve('infoElem', { skipCache: true });
  const panel = document.querySelector(panelSel);

  const expected = ctx.speedStore.smart() ?? ctx.speedStore.current();
  const playbackStarted = !!(videoEl?.played && videoEl.played.length > 0);

  const metrics = discovery.metrics();

  return {
    video_found: !!videoEl,
    video_ready: videoEl ? videoEl.readyState >= 1 || !!videoEl.currentSrc : false,
    playback_started: playbackStarted,
    playerContainer_found: !!playerR?.element,
    playerContainer_valid: !!(playerR?.element && Validators.playerContainer(playerR.element).ok),
    infoElem_found: !!infoR?.element,
    container_inserted: !!panel,
    container_visible: !!(panel instanceof HTMLElement && panel.offsetParent !== null),
    speed_button_count: document.querySelectorAll('.speed-button').length,
    speed_applied: !!videoEl && Math.abs(videoEl.playbackRate - expected) < 0.02,
    ratechange_revert_per_minute: meter.perMinute(),
    cache_hits: metrics.cacheHits,
    cache_misses: metrics.cacheMisses,
    cache_purges: metrics.cachePurges,
  };
}

/** Structural -- must be present before video starts playing. */
function structuralOk(checks: HealthChecks): boolean {
  return (
    checks.video_found &&
    checks.playerContainer_found &&
    checks.infoElem_found &&
    checks.container_inserted
  );
}

function computeHealthy(checks: HealthChecks, isWaiting: boolean): boolean {
  if (isWaiting) return true; // neutral, not unhealthy
  return structuralOk(checks) && checks.speed_applied && checks.ratechange_revert_per_minute < 6;
}

/**
 * Walk the failed checks and produce i18n keys for the diag-status block.
 * Translator handled at the caller (diag-status.ts already does this).
 */
function enumerateIssues(checks: HealthChecks, ctx: AppContext): string[] {
  const t = ctx.i18n.t;
  const list: string[] = [];
  if (!checks.video_found) list.push(t('diag.issue.video_not_found'));
  if (!checks.playerContainer_found) list.push(t('diag.issue.player_not_found'));
  if (!checks.infoElem_found) list.push(t('diag.issue.layout_unrecognised'));
  if (checks.video_found && !checks.container_inserted)
    list.push(t('diag.issue.panel_not_inserted'));
  if (checks.playback_started && !checks.speed_applied)
    list.push(t('diag.issue.speed_not_applied'));
  if (checks.ratechange_revert_per_minute >= 6) list.push(t('diag.issue.rate_resets'));
  return list;
}

export function reportToClipboardText(report: DiagnosticReport): string {
  try {
    return JSON.stringify(report, null, 2);
  } catch (e) {
    return `[HDREZKA-SPEEDS] Failed to serialize report: ${e instanceof Error ? e.message : String(e)}`;
  }
}

function redactUrl(): string {
  try {
    return location.origin + location.pathname;
  } catch {
    return '';
  }
}

function safeHostname(): string {
  try {
    return location.hostname;
  } catch {
    return 'unknown';
  }
}

// Re-export so callers can map SelectorKey directly without importing from discovery.
export type { SelectorKey };
