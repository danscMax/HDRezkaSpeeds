/**
 * SelectorCache -- hydrated-then-sync mirror over a single browser.storage.local
 * record. Audit H1: resolve() reads MUST be sync, so we keep all entries in
 * memory after the one-time hydrate; writes mirror immediately and persist
 * fire-and-forget.
 *
 * Storage shape (single key per host):
 *   vs-cache:<host> -> {
 *     schema_version: 1,
 *     script_version: <package version>,
 *     entries: { [selectorKey]: CacheEntry }
 *   }
 *
 * Schema/version mismatches are dropped on load -- the userscript used the
 * same trick and it kept the cache useful across releases without complex
 * migration code.
 *
 * Heuristic-source acceptance gate: a heuristic match is `tentative` until
 * two consecutive resolves produce the same signature. This stops us from
 * cementing a "lucky" wrong match into the cache.
 */

import { SELECTOR_CACHE_PREFIX } from '../config';
import type { StorageAdapter } from '../storage/adapter';
import type { CacheEntry, SelectorKey } from './types';

export interface SelectorCacheImpl {
  hydrate(): Promise<void>;
  isReady(): boolean;
  get(key: SelectorKey): CacheEntry | null;
  set(key: SelectorKey, payload: SetPayload): void;
  bumpSuccess(key: SelectorKey): void;
  /** Returns true if the failure crossed the auto-purge threshold. */
  bumpFailure(key: SelectorKey): boolean;
  purge(key: SelectorKey): void;
  purgeAll(): Promise<void>;
  buildSignature(el: Element): string;
  /**
   * Last-good entry archived just before the most recent `set()` that
   * changed signature. Used by the discovery engine as a fallback after
   * the primary entry fails to resolve / validate (audit M12, mirrors
   * .user.js:1153-1156 BACKUP_PREFIX behaviour). Returns null when no
   * backup has ever been written for the key.
   */
  tryRestoreBackup(key: SelectorKey): CacheEntry | null;
}

export interface SetPayload {
  selector: string;
  source: CacheEntry['source'];
  confidence: number;
  signature: string;
}

export interface SelectorCacheOptions {
  /** Bumped when the cache shape changes; mismatch drops everything. */
  schemaVersion?: number;
  /** Used to invalidate cache after extension updates. */
  scriptVersion: string;
  /** Hostname namespace for the storage key. Defaults to current host. */
  host?: string;
  /** TTL in ms; defaults to 7 days. */
  ttlMs?: number;
}

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_SCHEMA = 1;
const HEURISTIC_CONFIRM_COUNT = 2;
const FAILURE_PURGE_THRESHOLD = 3;

interface PersistedShape {
  schema_version: number;
  script_version: string;
  entries: Partial<Record<SelectorKey, CacheEntry>>;
  /**
   * Last-good entry archived per key whenever the primary entry's
   * signature changed (audit M12). Loaded alongside `entries` on hydrate.
   * Older snapshots may not have this field -- handled defensively.
   */
  backups?: Partial<Record<SelectorKey, CacheEntry>>;
}

export function createSelectorCache(
  adapter: StorageAdapter,
  opts: SelectorCacheOptions,
): SelectorCacheImpl {
  const schemaVersion = opts.schemaVersion ?? DEFAULT_SCHEMA;
  const scriptVersion = opts.scriptVersion;
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const host = opts.host ?? safeHostname();
  const storageKey = `${SELECTOR_CACHE_PREFIX}${host}`;

  const memCache = new Map<SelectorKey, CacheEntry>();
  const memBackups = new Map<SelectorKey, CacheEntry>();
  const tentative = new Map<SelectorKey, string[]>();
  let ready = false;
  // Audit 2026-05-09 M3: bound the persist() chain. The previous
  // unconditional `(pendingWrite ?? resolve()).then(...)` built an
  // ever-growing promise chain on tight bumpSuccess loops — a memory
  // leak on long-running tabs. We now keep at most one in-flight
  // promise + one queued; bursts during the in-flight window collapse
  // into a single trailing write that captures the latest snapshot.
  let inFlight: Promise<void> | null = null;
  let trailing = false;

  function flush(): Promise<void> {
    const snapshot: PersistedShape = {
      schema_version: schemaVersion,
      script_version: scriptVersion,
      entries: Object.fromEntries(memCache.entries()) as Partial<Record<SelectorKey, CacheEntry>>,
      backups:
        memBackups.size > 0
          ? (Object.fromEntries(memBackups.entries()) as Partial<Record<SelectorKey, CacheEntry>>)
          : undefined,
    };
    return adapter.set(storageKey, snapshot).catch(() => {
      // Storage may be unavailable in private mode / quota exceeded;
      // we still hold the in-memory mirror, so this is best-effort.
    });
  }

  function persist(): void {
    if (inFlight) {
      // A write is already in flight — mark trailing so we re-flush
      // exactly once after it lands, capturing the latest snapshot.
      trailing = true;
      return;
    }
    inFlight = flush().finally(() => {
      inFlight = null;
      if (trailing) {
        trailing = false;
        persist();
      }
    });
  }

  return {
    async hydrate(): Promise<void> {
      const raw = await adapter.get<PersistedShape | null>(storageKey, null);
      if (
        raw &&
        raw.schema_version === schemaVersion &&
        raw.script_version === scriptVersion &&
        raw.entries &&
        typeof raw.entries === 'object'
      ) {
        for (const [key, entry] of Object.entries(raw.entries)) {
          if (entry) memCache.set(key as SelectorKey, entry);
        }
        if (raw.backups && typeof raw.backups === 'object') {
          for (const [key, entry] of Object.entries(raw.backups)) {
            if (entry) memBackups.set(key as SelectorKey, entry);
          }
        }
      } else if (raw) {
        // Schema or script version drift: drop the persisted bag
        // (next set() rewrites the storage key cleanly).
        await adapter.remove(storageKey).catch(() => {});
      }
      ready = true;
    },

    isReady(): boolean {
      return ready;
    },

    get(key: SelectorKey): CacheEntry | null {
      const entry = memCache.get(key);
      if (!entry) return null;
      // Audit 2026-05-11 W5.4 (REL-009): expire entries whose
      // valid_until has passed. Falls through to selector tables /
      // heuristics to rebuild fresh.
      if (entry.valid_until && Date.now() > entry.valid_until) {
        memCache.delete(key);
        persist();
        return null;
      }
      return entry;
    },

    set(key: SelectorKey, payload: SetPayload): void {
      // Heuristic gate: only commit after two consecutive matches with the
      // same signature. Stops a one-off wrong match from cementing.
      if (payload.source === 'heuristic') {
        const seen = (tentative.get(key) ?? []).slice(-(HEURISTIC_CONFIRM_COUNT - 1));
        seen.push(payload.signature);
        if (
          seen.length < HEURISTIC_CONFIRM_COUNT ||
          seen[seen.length - 1] !== seen[seen.length - 2]
        ) {
          tentative.set(key, seen);
          return; // do not commit
        }
        tentative.delete(key);
      }

      const now = Date.now();
      const existing = memCache.get(key);
      // Audit M12: when an existing entry's signature changes (DOM rerender,
      // host-page upgrade), keep the previous good entry as a backup. The
      // discovery engine consults `tryRestoreBackup` after the primary cache
      // miss, before falling through to selector tables -- this saves us
      // a full re-scan when the rename was superficial.
      if (existing && existing.signature !== payload.signature) {
        memBackups.set(key, existing);
      }
      const entry: CacheEntry = {
        selector: payload.selector,
        source: payload.source,
        confidence: payload.confidence,
        signature: payload.signature,
        found_at: existing?.found_at ?? now,
        last_used_at: now,
        valid_until: now + ttlMs,
        success_count: existing?.success_count ?? 0,
        last_failure_count: 0,
      };
      memCache.set(key, entry);
      persist();
    },

    bumpSuccess(key: SelectorKey): void {
      const entry = memCache.get(key);
      if (!entry) return;
      entry.success_count += 1;
      entry.last_used_at = Date.now();
      entry.last_failure_count = 0;
      entry.valid_until = Date.now() + ttlMs;
      // Fire-and-forget: not critical to persist on every hit.
      persist();
    },

    bumpFailure(key: SelectorKey): boolean {
      const entry = memCache.get(key);
      if (!entry) return false;
      entry.last_failure_count += 1;
      if (entry.last_failure_count >= FAILURE_PURGE_THRESHOLD) {
        memCache.delete(key);
        persist();
        return true;
      }
      return false;
    },

    purge(key: SelectorKey): void {
      const had = memCache.delete(key);
      // Drop the backup too -- "user purged this key" is a strong signal
      // that nothing about its previous shape is trustworthy.
      const hadBackup = memBackups.delete(key);
      if (had || hadBackup) persist();
      tentative.delete(key);
    },

    async purgeAll(): Promise<void> {
      memCache.clear();
      memBackups.clear();
      tentative.clear();
      // Drain any in-flight write + cancel any trailing one so we don't
      // race a stale snapshot back over the removal we're about to commit.
      trailing = false;
      if (inFlight) {
        try {
          await inFlight;
        } catch {
          /* swallow */
        }
        inFlight = null;
      }
      await adapter.remove(storageKey).catch(() => {});
    },

    tryRestoreBackup(key: SelectorKey): CacheEntry | null {
      return memBackups.get(key) ?? null;
    },

    buildSignature(el: Element): string {
      try {
        const cls =
          typeof (el as HTMLElement).className === 'string'
            ? (el as HTMLElement).className.slice(0, 60)
            : '';
        const parentTag = el.parentElement?.tagName ?? '-';
        const role = el.getAttribute('role') ?? '';
        let depth = 0;
        for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) depth++;
        return [el.tagName, cls, parentTag, role, el.children.length, depth].join('|');
      } catch {
        return '';
      }
    },
  };
}

function safeHostname(): string {
  try {
    return location.hostname.toLowerCase();
  } catch {
    return 'unknown-host';
  }
}
