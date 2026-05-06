/**
 * Diagnostic report shape -- the JSON the user can copy from the
 * Diagnostics tab and ship to the developer.
 *
 * PII-redacted: `url_redacted` keeps origin + pathname only (no
 * query/hash/fragment). User agent, language, viewport, and feature
 * flags are included to triage browser-specific issues.
 *
 * Replaces the placeholder in src/app/ports.ts with a concrete shape.
 */

import type { DiscoveryMetrics } from '../discovery/types';
import type { RatechangeEvent } from '../speed/meter';
import type { Site } from '../app/ports';

export interface HealthChecks {
  video_found: boolean;
  video_ready: boolean;
  /** True when video.played.length > 0 -- the user has actually started it. */
  playback_started: boolean;
  playerContainer_found: boolean;
  playerContainer_valid: boolean;
  infoElem_found: boolean;
  /** Our panel root present in the DOM. */
  container_inserted: boolean;
  container_visible: boolean;
  speed_button_count: number;
  /** True when video.playbackRate matches the expected speed (within 0.02). */
  speed_applied: boolean;
  ratechange_revert_per_minute: number;
  cache_hits: number;
  cache_misses: number;
  cache_purges: number;
}

export interface KillSwitchSnapshot {
  discoveryEnabled: boolean;
  healthCheckEnabled: boolean;
}

export interface DiagnosticReport {
  schema_version: 1;
  generated_at: string;
  script_version: string;
  site: Site;
  hostname: string;
  url_redacted: string;
  user_agent: string;
  language: string;
  viewport: { w: number; h: number };

  /** Convenience: derived from checks but pre-computed for diff tools. */
  healthy: boolean;
  /** Distinguishes "video not started yet" from "actually broken". */
  isWaiting: boolean;

  checks: HealthChecks;
  ratechange_log_tail: RatechangeEvent[];
  discovery: DiscoveryMetrics;
  kill_switch: KillSwitchSnapshot;
  /** Rough textual issue summaries -- consumed by ui/settings/diag-status.ts
   *  to render the warn-state details. */
  issues: string[];
  /** Used by diag-status to render the "last check" timestamp. */
  lastCheckTime?: string;
}
