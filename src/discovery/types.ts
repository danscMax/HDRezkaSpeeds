/**
 * Domain types for the discovery layer.
 */

export const SELECTOR_KEYS = [
  'video',
  'playerContainer',
  'controlsContainer',
  'leftControls',
  'rightControls',
  'infoElem',
] as const;

export type SelectorKey = (typeof SELECTOR_KEYS)[number];

export type DiscoverySource = 'cache' | 'exact' | 'substring' | 'ancestor' | 'heuristic';

export interface ValidationResult {
  ok: boolean;
  reasons: string[];
}

export interface CacheEntry {
  selector: string;
  source: DiscoverySource;
  /** 0-1 confidence reported by whichever strategy found this entry. */
  confidence: number;
  /** Structural fingerprint of the matched element at time of write. */
  signature: string;
  /** Epoch ms when this entry was first written (or restored from backup). */
  found_at: number;
  /** Epoch ms when the entry was last successfully resolved. */
  last_used_at: number;
  /** Epoch ms after which the entry is considered stale and revalidated. */
  valid_until: number;
  /** Bumped on every successful resolve(); resets to 0 on a miss. */
  success_count: number;
  /** Number of consecutive failures since last success; >=3 triggers purge. */
  last_failure_count: number;
}

export interface ResolveResult {
  element: Element;
  source: DiscoverySource;
  selector: string;
  signature: string;
  confidence: number;
}

export interface DiscoveryMetrics {
  cacheHits: number;
  cacheMisses: number;
  cachePurges: number;
  /** Last source per key, e.g. { video: 'cache', playerContainer: 'heuristic' }. */
  lastBySource: Partial<Record<SelectorKey, DiscoverySource | null>>;
}

export type Validator = (el: Element | null) => ValidationResult;
