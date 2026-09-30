/**
 * Main-owned settings persistence — schema-versioned, validated on read, atomic write.
 * Path: {userData}/launcher-data/settings.json
 * Never stores auth/session/instance state.
 */

import fs from "node:fs";
import path from "node:path";
import type { SettingsDto } from "../../shared/contract.js";

export const SETTINGS_SCHEMA_VERSION = 1 as const;
export const SETTINGS_FILENAME = "settings.json";

/** Desktop IPC / settings policy — aligns with normalizeSettings (stricter than 0.3B floor 256). */
export const SETTINGS_MEMORY_MIN_MIB = 512;
export const SETTINGS_MEMORY_MAX_MIB = 32768;
export const SETTINGS_MEMORY_DEFAULT_MIB = 2048;

export interface PersistedSettingsFile {
  readonly schemaVersion: typeof SETTINGS_SCHEMA_VERSION;
  readonly language: "fr";
  readonly reducedMotion: boolean;
  readonly memoryMiB: number;
  /** PACK-10.1G — absolute SweetCraft instance root; absent = legacy default. */
  readonly sweetcraftInstancePath?: string | null;
}

export const DEFAULT_SETTINGS: SettingsDto = Object.freeze({
  language: "fr",
  reducedMotion: false,
  memoryMiB: SETTINGS_MEMORY_DEFAULT_MIB
});

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function settingsFilePath(dataDir: string): string {
  return path.join(dataDir, SETTINGS_FILENAME);
}

export function isValidMemoryMiB(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= SETTINGS_MEMORY_MIN_MIB &&
    value <= SETTINGS_MEMORY_MAX_MIB
  );
}

/**
 * Parse persisted settings. Corrupt / unknown schema → safe defaults (fail-safe).
 * Never throws for corrupt content.
 */
export function parsePersistedSettings(raw: unknown): PersistedSettingsFile {
  if (!isPlainObject(raw) || raw.schemaVersion !== SETTINGS_SCHEMA_VERSION) {
    return toPersisted(DEFAULT_SETTINGS);
  }
  const reducedMotion = typeof raw.reducedMotion === "boolean" ? raw.reducedMotion : false;
  const memoryMiB = isValidMemoryMiB(raw.memoryMiB)
    ? raw.memoryMiB
    : SETTINGS_MEMORY_DEFAULT_MIB;
  let sweetcraftInstancePath: string | null | undefined;
  if (raw.sweetcraftInstancePath === null) {
    sweetcraftInstancePath = null;
  } else if (typeof raw.sweetcraftInstancePath === "string" && raw.sweetcraftInstancePath.trim()) {
    sweetcraftInstancePath = raw.sweetcraftInstancePath.trim();
  }

  // language is always fr — ignore/reject other values by falling back.
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    language: "fr",
    reducedMotion,
    memoryMiB,
    ...(sweetcraftInstancePath !== undefined ? { sweetcraftInstancePath } : {})
  };
}

export function toPersisted(dto: SettingsDto): PersistedSettingsFile {
  const base: PersistedSettingsFile = {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    language: "fr",
    reducedMotion: dto.reducedMotion === true,
    memoryMiB: isValidMemoryMiB(dto.memoryMiB) ? dto.memoryMiB : SETTINGS_MEMORY_DEFAULT_MIB
  };
  if (dto.sweetcraftInstancePath !== undefined) {
    return { ...base, sweetcraftInstancePath: dto.sweetcraftInstancePath };
  }
  return base;
}

export function toSettingsDto(file: PersistedSettingsFile): SettingsDto {
  return {
    language: "fr",
    reducedMotion: file.reducedMotion,
    memoryMiB: file.memoryMiB,
    ...(file.sweetcraftInstancePath !== undefined && file.sweetcraftInstancePath !== null
      ? { sweetcraftInstancePath: file.sweetcraftInstancePath }
      : {})
  };
}

export function loadSettingsStore(dataDir: string): SettingsDto {
  const file = settingsFilePath(dataDir);
  try {
    if (!fs.existsSync(file)) {
      return { ...DEFAULT_SETTINGS };
    }
    const text = fs.readFileSync(file, "utf8");
    if (text.length > 64_000) {
      return { ...DEFAULT_SETTINGS };
    }
    return toSettingsDto(parsePersistedSettings(JSON.parse(text) as unknown));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Atomic write: tmp + rename. */
export function saveSettingsStore(dataDir: string, dto: SettingsDto): void {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = settingsFilePath(dataDir);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const payload = toPersisted(dto);
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  fs.writeFileSync(tmp, json, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, file);
}
