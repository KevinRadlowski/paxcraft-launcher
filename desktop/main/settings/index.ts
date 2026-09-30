export {
  SETTINGS_SCHEMA_VERSION,
  SETTINGS_FILENAME,
  SETTINGS_MEMORY_MIN_MIB,
  SETTINGS_MEMORY_MAX_MIB,
  SETTINGS_MEMORY_DEFAULT_MIB,
  DEFAULT_SETTINGS,
  parsePersistedSettings,
  loadSettingsStore,
  saveSettingsStore,
  settingsFilePath,
  isValidMemoryMiB,
  toSettingsDto,
  toPersisted,
  type PersistedSettingsFile
} from "./settings-store.js";

export {
  assertSettingsUpdatePayload,
  applySettingsUpdate,
  type SettingsUpdateDto
} from "./settings-dto.js";

export {
  SettingsDesktopService,
  createSettingsDesktopService
} from "./settings-service.js";
