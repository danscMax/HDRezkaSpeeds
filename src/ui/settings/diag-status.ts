/**
 * Diagnostic status block updater.
 *
 * Reads the current report from `ctx.diagnostics.report()` and projects it
 * into the four-state status block (idle / waiting / ok / warn) inside the
 * Diagnostics tab.
 *
 * `waiting` is a deliberate first-class state (project memory: avoid
 * false-alarm when the video hasn't been started yet -- distinguish from
 * `unhealthy`).
 *
 * Ported from .user.js:4320-4368.
 */

import type { AppContext } from '../../app/context';

type StatusState = 'idle' | 'waiting' | 'ok' | 'warn';

interface DiagViewModel {
  state: StatusState;
  headline: string;
  detail: string;
}

export function refreshDiagnosticStatus(menuRoot: Element, ctx: AppContext): void {
  const statusEl = menuRoot.querySelector<HTMLElement>('[data-vs-diag-status]');
  const headlineEl = menuRoot.querySelector<HTMLElement>('[data-vs-diag-headline]');
  const detailEl = menuRoot.querySelector<HTMLElement>('[data-vs-diag-detail]');
  if (!statusEl || !headlineEl || !detailEl) return;

  const vm = projectReport(ctx);
  statusEl.dataset.state = vm.state;
  headlineEl.textContent = vm.headline;
  detailEl.textContent = vm.detail;
}

/**
 * Map the diagnostic report into the four-state view model. The shape of
 * the report itself is owned by Wave 1.9 (`DiagnosticReport`); for now we
 * read a few well-known fields defensively so render stays stable until
 * the full report lands.
 */
function projectReport(ctx: AppContext): DiagViewModel {
  const t = ctx.i18n.t;
  const report = safeReport(ctx);

  if (!report) {
    return {
      state: 'idle',
      headline: t('diag.status.not_checked'),
      detail: t('diag.status.click_to_check'),
    };
  }

  const waiting = readBool(report, 'isWaiting');
  if (waiting) {
    return {
      state: 'waiting',
      headline: t('diag.status.waiting'),
      detail: t('diag.status.waiting_detail'),
    };
  }

  if (ctx.diagnostics.isHealthy()) {
    const time = readString(report, 'lastCheckTime') ?? '';
    return {
      state: 'ok',
      headline: t('diag.status.ok'),
      detail: time ? t('diag.status.last_check', { time }) : '',
    };
  }

  const issues = readStringArray(report, 'issues');
  if (issues.length === 1) {
    return {
      state: 'warn',
      headline: t('diag.status.issue_single', { issue: issues[0] ?? '' }),
      detail: t('diag.status.try_again'),
    };
  }

  // Multi-issue: list them as bullets in the detail field. Mirror
  // .user.js:4344-4365 — without this, users only see "N issues" and
  // have to click "Copy report" to learn what specifically broke. CSS
  // .vs-status-detail uses `white-space: pre-line` so \n renders as
  // visible line break (audit B3.1).
  const detail =
    issues.length > 0 ? issues.map((s) => `• ${s}`).join('\n') : t('diag.status.try_again');
  return {
    state: 'warn',
    headline: t('diag.status.issues_count', { count: issues.length }),
    detail,
  };
}

function safeReport(ctx: AppContext): Record<string, unknown> | null {
  try {
    const r = ctx.diagnostics.report();
    return r && typeof r === 'object' ? (r as unknown as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readBool(obj: Record<string, unknown>, key: string): boolean {
  return obj[key] === true;
}

function readString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
}

function readStringArray(obj: Record<string, unknown>, key: string): string[] {
  const v = obj[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}
