import { assertSafeConfigPath } from "../paths/index.js";
import { ErrorCode, LauncherError } from "../errors/index.js";

/** JSON leaf values allowed in pack-declared config migrations. */
export type ConfigMigrationLeafValue = boolean | number | string | null;

export interface ConfigMigrationSetEntry {
  /** Dot-separated object path (no array indices). */
  path: string;
  value: ConfigMigrationLeafValue;
}

export interface ManifestConfigMigration {
  /** Stable one-shot id recorded in instance state when applied. */
  id: string;
  /** Relative POSIX path under instance root (must start with config/). */
  configPath: string;
  /** Apply only when previous installedPackVersion matches one of these (exact). */
  fromPackVersions?: string[];
  /** Explicit leaf paths to set — no wildcards, no arbitrary patching. */
  set: ConfigMigrationSetEntry[];
}

const MIGRATION_ID_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const JSON_PATH_SEGMENT_RE = /^[A-Za-z0-9_]+$/;
const MAX_MIGRATIONS = 32;
const MAX_SET_ENTRIES = 16;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertValidJsonPath(path: string): void {
  if (typeof path !== "string" || !path) {
    throw new LauncherError(ErrorCode.INVALID_MANIFEST, "config migration set.path empty");
  }
  const segments = path.split(".");
  if (segments.some(s => !JSON_PATH_SEGMENT_RE.test(s))) {
    throw new LauncherError(ErrorCode.INVALID_MANIFEST, "config migration set.path has invalid segments", {
      path
    });
  }
}

function parseSetEntry(raw: unknown, migrationIndex: number, setIndex: number): ConfigMigrationSetEntry {
  if (!isPlainObject(raw)) {
    throw new LauncherError(
      ErrorCode.INVALID_MANIFEST,
      `configMigrations[${migrationIndex}].set[${setIndex}] invalid`
    );
  }
  if (typeof raw.path !== "string" || !raw.path) {
    throw new LauncherError(
      ErrorCode.INVALID_MANIFEST,
      `configMigrations[${migrationIndex}].set[${setIndex}].path missing`
    );
  }
  assertValidJsonPath(raw.path);
  const value = raw.value;
  if (
    value !== null &&
    typeof value !== "boolean" &&
    typeof value !== "number" &&
    typeof value !== "string"
  ) {
    throw new LauncherError(
      ErrorCode.INVALID_MANIFEST,
      `configMigrations[${migrationIndex}].set[${setIndex}].value must be JSON leaf`
    );
  }
  return { path: raw.path, value: value as ConfigMigrationLeafValue };
}

export function parseConfigMigration(raw: unknown, index: number): ManifestConfigMigration {
  if (!isPlainObject(raw)) {
    throw new LauncherError(ErrorCode.INVALID_MANIFEST, `configMigrations[${index}] invalid`);
  }
  if (typeof raw.id !== "string" || !MIGRATION_ID_RE.test(raw.id)) {
    throw new LauncherError(ErrorCode.INVALID_MANIFEST, `configMigrations[${index}].id invalid`, {
      id: raw.id
    });
  }
  if (typeof raw.configPath !== "string" || !raw.configPath) {
    throw new LauncherError(ErrorCode.INVALID_MANIFEST, `configMigrations[${index}].configPath missing`);
  }
  assertSafeConfigPath(raw.configPath);
  let fromPackVersions: string[] | undefined;
  if (raw.fromPackVersions !== undefined) {
    if (!Array.isArray(raw.fromPackVersions) || raw.fromPackVersions.length === 0) {
      throw new LauncherError(
        ErrorCode.INVALID_MANIFEST,
        `configMigrations[${index}].fromPackVersions must be non-empty array when present`
      );
    }
    fromPackVersions = raw.fromPackVersions.map((v, i) => {
      if (typeof v !== "string" || !v) {
        throw new LauncherError(
          ErrorCode.INVALID_MANIFEST,
          `configMigrations[${index}].fromPackVersions[${i}] invalid`
        );
      }
      return v;
    });
  }
  if (!Array.isArray(raw.set) || raw.set.length === 0) {
    throw new LauncherError(ErrorCode.INVALID_MANIFEST, `configMigrations[${index}].set must be non-empty array`);
  }
  if (raw.set.length > MAX_SET_ENTRIES) {
    throw new LauncherError(ErrorCode.INVALID_MANIFEST, `configMigrations[${index}].set exceeds limit`, {
      max: MAX_SET_ENTRIES
    });
  }
  const set = raw.set.map((entry, setIndex) => parseSetEntry(entry, index, setIndex));
  const paths = new Set(set.map(s => s.path));
  if (paths.size !== set.length) {
    throw new LauncherError(ErrorCode.INVALID_MANIFEST, `configMigrations[${index}].set has duplicate paths`);
  }
  return {
    id: raw.id,
    configPath: raw.configPath,
    ...(fromPackVersions ? { fromPackVersions } : {}),
    set
  };
}

export function parseConfigMigrations(raw: unknown): ManifestConfigMigration[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new LauncherError(ErrorCode.INVALID_MANIFEST, "configMigrations must be an array when present");
  }
  if (raw.length > MAX_MIGRATIONS) {
    throw new LauncherError(ErrorCode.INVALID_MANIFEST, "configMigrations exceeds limit", {
      max: MAX_MIGRATIONS
    });
  }
  const migrations = raw.map((m, i) => parseConfigMigration(m, i));
  const ids = new Set(migrations.map(m => m.id));
  if (ids.size !== migrations.length) {
    throw new LauncherError(ErrorCode.INVALID_MANIFEST, "duplicate configMigrations id");
  }
  return migrations;
}
