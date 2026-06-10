/**
 * Port interfaces for AppContext.
 *
 * These declare the *shape* of every collaborator that downstream features
 * (speed controller, UI, health, sites) consume. Concrete implementations
 * land in their own waves:
 *   - SettingsStore / SpeedStore         -> Wave 1.4 storage/
 *   - UiPort impls                       -> Wave 1.8a/b/c ui/
 *   - DiscoveryPort                      -> Wave 1.6 discovery/
 *   - DiagnosticsPort                    -> Wave 1.9 health/
 *   - Logger                             -> Wave 1.5 utils/logger.ts
 *   - Translator                         -> Wave 1.3 i18n/
 *
 * The point of declaring them now (audit C2) is so each feature module can
 * code against an interface and never reach back into another feature. If
 * `ui/settings/handlers.ts` wants to flip a setting, it asks ctx.settingsStore
 * — never imports `storage/settings-store.ts` directly. Same for everything
 * else. That is what keeps the import graph acyclic.
 *
 * The data-shape types (Settings, DiagnosticReport, NotificationKind) are
 * left as `unknown` placeholders here on purpose: each owning wave fills
 * them in without touching the port surface.
 */

export type Site = 'hdrezka';

// ---------------------------------------------------------------------------
// Storage ports — hydrated sync getters, async writes (audit C1).
// `init()` is the ONLY async surface. After it resolves, hot paths
// (ratechange, hotkeys, click-handler) read state synchronously.
//
// The concrete Settings + Hotkey shapes live in src/storage/types.ts so
// the storage layer can own its data model. We re-export them as types
// (erased at runtime, no runtime dep cycle) so port consumers can stay
// fully typed without crossing the abstraction.
// ---------------------------------------------------------------------------

export type { Hotkey, Settings, SliderPosition } from '../storage/types';

import type { Settings } from '../storage/types';

export interface SettingsStore {
  init(site: Site): Promise<void>;
  get(): Settings;
  getKey<K extends keyof Settings>(key: K): Settings[K];
  update(patch: Partial<Settings>): Promise<void>;
  subscribe(fn: (next: Settings) => void): () => void;
}

export interface SpeedStore {
  init(site: Site): Promise<void>;
  /** Currently selected speed (e.g. 1.5). Sync after init. */
  current(): number;
  /** Last "smart" speed (Wave 1.7) — null if rememberSpeed is off. */
  smart(): number | null;
  setCurrent(speed: number): Promise<void>;
  setSmart(speed: number | null): Promise<void>;
  /** FEAT-015: per-content speed memory (HDRezka title / YT channel). */
  setActiveMemoryKey(key: string | null): void;
  activeMemoryKey(): string | null;
  activeMemory(): number | null;
  rememberForActive(speed: number): Promise<void>;
}

// ---------------------------------------------------------------------------
// UI port — the speed controller talks to the panel through this and never
// reaches into DOM directly. Wave 1.8 supplies a concrete impl.
// ---------------------------------------------------------------------------

export type NotificationKind = 'info' | 'success' | 'warn' | 'error';

export interface RefreshOptions {
  /**
   * Suppress the centred "1.50x" speed popup. Use when the rate change is
   * NOT user-initiated (HLS cascade reset, ratechange-revert, retry storms,
   * or accepting an external YouTube speed-menu pick) — those would
   * otherwise spam the popup on every video start. Mirrors the
   * `showPopup=false` flag in .user.js setSpeed/loaders (audit B2.6).
   */
  silent?: boolean;
}

export interface UiPort {
  refreshButtons(speed: number, opts?: RefreshOptions): void;
  refreshSlider(speed: number): void;
  showNotification(text: string, kind?: NotificationKind): void;
  /** Re-apply layout (slider position, button row order) after settings change. */
  applyLayout(): void;
}

// ---------------------------------------------------------------------------
// Discovery port — finds page elements (video, controls bar, gear container).
// Backed by a hydrated SelectorCache mirror (audit H1) so resolve() is sync.
// ---------------------------------------------------------------------------

export interface DiscoveryPort {
  /** Hydrate the in-memory cache mirror from browser.storage.local. */
  hydrate(): Promise<void>;
  resolve(key: string): Element | null;
  invalidate(key: string): void;
  cacheStats(): { hits: number; misses: number; ready: boolean };
}

// ---------------------------------------------------------------------------
// Diagnostics port — health checker, kill-switch, structured report.
// Wave 1.9 supplies the concrete impl. Settings/UI consume report() to
// render the diagnostics tab.
// ---------------------------------------------------------------------------

export type { DiagnosticReport } from '../health/types';

import type { DiagnosticReport } from '../health/types';

export interface DiagnosticsPort {
  report(): DiagnosticReport;
  isHealthy(): boolean;
  killSwitchEngaged(): boolean;
  trip(reason: string): void;
}

// ---------------------------------------------------------------------------
// Logger — vendor wrapper around Userscript Logger Pro (Wave 1.5) plus a
// build-time log-level filter (audit L4). All features log through this.
// ---------------------------------------------------------------------------

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

// ---------------------------------------------------------------------------
// Translator — i18n surface (Wave 1.3). Pure functions, no globals.
// Contract (audit M3): t() returns plain text only. Markup is built from
// trusted templates outside i18n. escHtml() always wraps user-facing text
// when the template uses backticks + ${} interpolation.
// ---------------------------------------------------------------------------

export interface Translator {
  t(key: string, vars?: Record<string, string | number>): string;
  escHtml(input: string): string;
}
