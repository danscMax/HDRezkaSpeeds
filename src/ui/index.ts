export { h, svgEl, fragment, type HAttrs, type HChild } from './dom-h';
export { vsIcon, ICON_NAMES, type IconName } from './icons';
export { showNotification, type NotificationOptions } from './notifications';
export { showSpeedPopup } from './popup';
export {
  DEFAULT_PRESETS,
  refreshActiveButton,
  renderButtonsRow,
  type ButtonsRowOptions,
} from './buttons';
export {
  renderSlider,
  setSliderValue,
  updateSliderFill,
  type SliderOptions,
} from './slider';
export {
  injectStyles,
  removeStyles,
  detectAndApplyTheme,
  installThemeWatcher,
} from './styles';
export {
  renderSettingsMenu,
  type ActiveTab,
  type ModalRenderOptions,
} from './settings/modal';
export {
  generateHotkeyBlock,
  type HotkeyAction,
} from './settings/hotkey-block';
export {
  attachSettingsHandlers,
  type SettingsHandlersDeps,
} from './settings/handlers';
export { refreshDiagnosticStatus } from './settings/diag-status';
export {
  buildExportEnvelope,
  exportSettingsToFile,
  importSettingsFromText,
  openImportPicker,
  type ExportEnvelope,
  type ImportResult,
} from './settings/export-import';
export { createPanel, type CreatePanelOptions, type PanelHandle } from './panel';
export { detachPanel, insertPanel, type InsertionResult } from './insertion';
export { createUiPort, type CreateUiPortOptions } from './ui-port';
