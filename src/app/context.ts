import type { CleanupRegistry } from './cleanup';
import type {
  DiagnosticsPort,
  DiscoveryPort,
  Logger,
  SettingsStore,
  Site,
  SpeedStore,
  Translator,
  UiPort,
} from './ports';

/**
 * Immutable bundle of collaborators passed through every feature module.
 *
 * Build it once in the orchestrator (Wave 1.10 `bootstrap(ctx)`), then thread
 * it through. No feature module should reach for globals or import another
 * feature's concrete impl — they only see this interface.
 *
 * Lifetime = one content-script load. On WXT invalidation we call
 * `ctx.cleanup.dispose()` and drop the reference; the next load creates a
 * fresh AppContext with a fresh CleanupRegistry.
 */
export interface AppContext {
  readonly site: Site;
  readonly settingsStore: SettingsStore;
  readonly speedStore: SpeedStore;
  /**
   * UI surface. Mutable specifically so the orchestrator can swap a stub
   * for the real impl during bootstrap (panel needs ctx -> stub UI is
   * passed in so panel can build -> real UiPort wraps the panel handle ->
   * orchestrator overwrites this field). After bootstrap returns, treat
   * as effectively-readonly.
   */
  ui: UiPort;
  readonly discovery: DiscoveryPort;
  /** Mutable for the same bootstrap-time swap reason as `ui`. */
  diagnostics: DiagnosticsPort;
  readonly cleanup: CleanupRegistry;
  readonly logger: Logger;
  /** Mutable for the same reason as `ui`: language switch in settings
   *  rebuilds the translator, and downstream modules need to see the new
   *  one without rebuilding ctx. */
  i18n: Translator;
}
