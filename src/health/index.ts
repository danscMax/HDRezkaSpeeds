export { createKillSwitch, type KillSwitch } from './kill-switch';
export { buildReport, reportToClipboardText, type ReportDeps } from './report';
export {
  createHealthChecker,
  type HealthChecker,
  type CreateHealthCheckerDeps,
} from './checker';
export type {
  DiagnosticReport,
  HealthChecks,
  KillSwitchSnapshot,
} from './types';
