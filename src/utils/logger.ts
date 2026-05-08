/**
 * Logger adapted from `Userscript Logger Pro` (own library, MaxScorpy).
 * Vendored here as a TypeScript port instead of a runtime dependency so
 * the extension bundle stays self-contained.
 *
 * Differences from the userscript version:
 *   - Implements the `Logger` port (src/app/ports.ts) -- debug/info/warn/error.
 *     `success` and `_log` from the original collapse into the four-level
 *     surface that matches console method semantics.
 *   - Build-time level filter via Vite's `import.meta.env.DEV`. Production
 *     builds (DEV=false) silence debug+info; warn/error always go through
 *     so end users still see real problems in their console.
 *   - No `unsafeWindow`. Logs go to `console.*` directly.
 *
 * History buffer is kept (small ring, last N entries) so the diagnostics
 * tab "copy report" button (Wave 1.8b) can include the most recent log
 * lines without us touching `console.*` again.
 */

import type { Logger } from '../app/ports';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerOptions {
  /** Tag prefix shown in every line, e.g. "VIDEO-SPEEDS". */
  scriptName?: string;
  /** Single-glyph icon shown next to the tag. Defaults to lightning. */
  emoji?: string;
  /**
   * Lowest level that actually reaches console. Anything below is dropped.
   * Defaults to `debug` in dev and `warn` in production builds.
   */
  minLevel?: LogLevel;
  /** Max ring-buffer entries kept for diagnostics export. Defaults to 200. */
  historySize?: number;
}

interface HistoryEntry {
  ts: number;
  level: LogLevel;
  message: string;
  details: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const STYLE: Record<LogLevel, { glyph: string; color: string; method: 'log' | 'warn' | 'error' }> =
  {
    debug: { glyph: '🔍', color: '#9b59b6', method: 'log' },
    info: { glyph: 'ℹ', color: '#3498db', method: 'log' },
    warn: { glyph: '⚠', color: '#f39c12', method: 'warn' },
    error: { glyph: '✖', color: '#e74c3c', method: 'error' },
  };

/**
 * Build the default min-level from Vite's DEV flag. WXT injects
 * `import.meta.env.DEV` automatically; production builds = false.
 */
function defaultMinLevel(): LogLevel {
  // import.meta.env is provided by Vite. Tests run via Vitest which also
  // sets it, so this works in both environments.
  // The `as any` cast keeps tsc happy in environments where the type
  // augmentation isn't loaded.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const env = ((import.meta as any).env ?? {}) as { DEV?: boolean };
  return env.DEV === false ? 'warn' : 'debug';
}

export interface ExtendedLogger extends Logger {
  /** Snapshot of recent log lines for the diagnostics report. */
  history(): readonly HistoryEntry[];
  /** Override min-level at runtime (e.g. settings toggle in Wave 1.8b). */
  setLevel(level: LogLevel): void;
}

export function createLogger(opts: LoggerOptions = {}): ExtendedLogger {
  const scriptName = opts.scriptName ?? 'HDREZKA-SPEEDS';
  const emoji = opts.emoji ?? '⚡';
  let minLevel = opts.minLevel ?? defaultMinLevel();
  const maxHistory = opts.historySize ?? 200;
  const history: HistoryEntry[] = [];

  function emit(level: LogLevel, args: unknown[]): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;

    const message = String(args[0] ?? '');
    const details = args.length > 1 ? args.slice(1) : null;

    history.push({ ts: Date.now(), level, message, details });
    if (history.length > maxHistory) history.shift();

    const style = STYLE[level];
    const ts = new Date().toLocaleTimeString();
    const prefix = `%c${emoji} [${scriptName}] ${style.glyph} ${level.toUpperCase()} [${ts}] ${message}`;
    const css = `color: ${style.color}; font-weight: bold;`;

    // Use the level-appropriate console method so DevTools' filter
    // checkboxes work as users expect.
    if (details) {
      console[style.method](prefix, css, ...(details as unknown[]));
    } else {
      console[style.method](prefix, css);
    }
  }

  return {
    debug: (...args) => emit('debug', args),
    info: (...args) => emit('info', args),
    warn: (...args) => emit('warn', args),
    error: (...args) => emit('error', args),
    history: () => history,
    setLevel: (level) => {
      minLevel = level;
    },
  };
}
