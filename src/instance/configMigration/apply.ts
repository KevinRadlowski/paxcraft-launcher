import { readFile } from "node:fs/promises";
import type { ManifestConfigMigration } from "../../core/manifest/configMigration.js";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import { hashFileSha256Simple, writeFileAtomic } from "../../download/fs/index.js";
import type { InstancePaths } from "../layout/index.js";
import { resolveSafeInstancePath } from "../security/index.js";
import type { InstanceState, ManagedFileRecord } from "../state/instanceState.js";
import { getAtPath, setLeafPath } from "./jsonPaths.js";

export interface ConfigMigrationApplyResult {
  appliedIds: string[];
  files: ManagedFileRecord[];
}

function migrationEligible(
  migration: ManifestConfigMigration,
  previousState: InstanceState,
  alreadyApplied: ReadonlySet<string>
): boolean {
  if (alreadyApplied.has(migration.id)) return false;
  if (migration.fromPackVersions && migration.fromPackVersions.length > 0) {
    const prev = previousState.installedPackVersion;
    if (!prev || !migration.fromPackVersions.includes(prev)) return false;
  }
  return true;
}

function updateManagedFileRecord(
  files: ManagedFileRecord[],
  configPath: string,
  sha256: string,
  size: number
): ManagedFileRecord[] {
  const idx = files.findIndex(f => f.type === "config" && f.targetPath === configPath);
  if (idx < 0) return files;
  const next = [...files];
  next[idx] = { ...next[idx]!, sha256, size };
  return next;
}

export async function patchConfigMigrationFile(opts: {
  migration: ManifestConfigMigration;
  paths: InstancePaths;
  managedFiles: ManagedFileRecord[];
  missingFile: "skip" | "fail";
}): Promise<{ changed: boolean; files: ManagedFileRecord[]; recorded: boolean }> {
  const abs = await resolveSafeInstancePath(opts.paths, opts.migration.configPath);
  let rawText: string;
  try {
    rawText = await readFile(abs, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      if (opts.missingFile === "skip") {
        return { changed: false, files: opts.managedFiles, recorded: false };
      }
      throw new LauncherError(ErrorCode.CONFIG_MIGRATION_FAILED, "migration target file missing", {
        migrationId: opts.migration.id,
        configPath: opts.migration.configPath
      });
    }
    throw new LauncherError(ErrorCode.CONFIG_MIGRATION_FAILED, "failed to read migration target", {
      migrationId: opts.migration.id,
      configPath: opts.migration.configPath,
      cause: e instanceof Error ? e.message : String(e)
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (e) {
    throw new LauncherError(ErrorCode.CONFIG_MIGRATION_FAILED, "migration target JSON parse failed", {
      migrationId: opts.migration.id,
      configPath: opts.migration.configPath,
      cause: e instanceof Error ? e.message : String(e)
    });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new LauncherError(ErrorCode.CONFIG_MIGRATION_FAILED, "migration target root must be a JSON object", {
      migrationId: opts.migration.id,
      configPath: opts.migration.configPath
    });
  }

  const root = parsed as Record<string, unknown>;
  let changed = false;
  for (const entry of opts.migration.set) {
    const before = getAtPath(root, entry.path);
    if (Object.is(before, entry.value)) continue;
    if (setLeafPath(root, entry.path, entry.value)) {
      changed = true;
    }
  }

  let files = opts.managedFiles;
  if (changed) {
    const payload = JSON.stringify(root, null, 4) + "\n";
    await writeFileAtomic(abs, payload);
    const h = await hashFileSha256Simple(abs);
    files = updateManagedFileRecord(files, opts.migration.configPath, h.sha256, h.size);
  }

  return { changed, files, recorded: true };
}

/**
 * Apply declarative one-shot config migrations after whole-file install plan.
 * Never replaces entire files — only explicit leaf paths from the manifest contract.
 */
export async function applyConfigMigrations(opts: {
  migrations: ManifestConfigMigration[];
  paths: InstancePaths;
  previousState: InstanceState;
  managedFiles: ManagedFileRecord[];
}): Promise<ConfigMigrationApplyResult> {
  const alreadyApplied = new Set(opts.previousState.appliedConfigMigrations ?? []);
  const appliedIds: string[] = [];
  let files = opts.managedFiles;

  for (const migration of opts.migrations) {
    if (!migrationEligible(migration, opts.previousState, alreadyApplied)) continue;

    const patched = await patchConfigMigrationFile({
      migration,
      paths: opts.paths,
      managedFiles: files,
      missingFile: "skip"
    });
    files = patched.files;
    if (!patched.recorded) continue;
    appliedIds.push(migration.id);
    alreadyApplied.add(migration.id);
  }

  return { appliedIds, files };
}
