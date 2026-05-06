export {
  createBrowserStorageAdapter,
  createMemoryStorageAdapter,
  type StorageAdapter,
} from './adapter';
export { normalizeHotkeys } from './hotkey-migrate';
export {
  createSettingsStore,
  type SettingsStoreImpl,
} from './settings-store';
export {
  createSpeedStore,
  type SpeedStoreImpl,
} from './speed-store';
export { runTmMigration, type TmMigrationResult } from './migration-tm';
export {
  defaultSettings,
  type Hotkey,
  type Settings,
  type SliderPosition,
} from './types';
