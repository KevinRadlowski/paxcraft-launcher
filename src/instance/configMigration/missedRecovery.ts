import { readFile } from "node:fs/promises";
import type { TrustedResolvedRelease } from "../../core/resolve/index.js";
import type { ManifestConfigMigration } from "../../core/manifest/configMigration.js";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import type { InstancePaths } from "../layout/index.js";
import { resolveSafeInstancePath } from "../security/index.js";
import type { InstanceState, ManagedFileRecord } from "../state/instanceState.js";
import { getAtPath } from "./jsonPaths.js";
import { patchConfigMigrationFile } from "./apply.js";

export type MissedMigrationRecoverySkipReason =
  | "already_applied"
  | "not_transition_migration"
  | "still_on_source_version"
  | "no_transition_evidence"
  | "release_identity_mismatch"
  | "migration_not_in_manifest"
  | "target_file_absent"
  | "no_missed_evidence";

export type MissedMigrationRecoveryOutcome =
  | { kind: "eligible"; migration: ManifestConfigMigration }
  | { kind: "skip"; reason: MissedMigrationRecoverySkipReason }
  | { kind: "reject"; reason: "malformed_json" | "unsafe_target" | "user_modified_leaf" };

export interface MissedMigrationRecoveryContext {
  state: InstanceState;
  resolved: TrustedResolvedRelease;
  paths: InstancePaths;
}

export interface MissedMigrationRecoveryResult {
  appliedIds: string[];
  files: ManagedFileRecord[];
  nextState: InstanceState;
}

function trustedManifestSha256(resolved: TrustedResolvedRelease): string {
  return resolved.release.release.artefacts.clientManifest.sha256;
}

function releaseIdentityMatches(state: InstanceState, resolved: TrustedResolvedRelease): boolean {
  return (
    state.installedReleaseSha256 === resolved.candidate.releaseSha256 &&
    state.installedManifestSha256 === trustedManifestSha256(resolved)
  );
}

function findManifestMigration(
  resolved: TrustedResolvedRelease,
  migrationId: string
): ManifestConfigMigration | undefined {
  return (resolved.clientManifest.configMigrations ?? []).find(m => m.id === migrationId);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when durable prior pack versions intersect migration.fromPackVersions. */
export function hasPriorPackTransitionEvidence(
  state: Pick<InstanceState, "priorPackVersions">,
  fromPackVersions: readonly string[]
): boolean {
  const prior = state.priorPackVersions ?? [];
  if (prior.length === 0 || fromPackVersions.length === 0) return false;
  const from = new Set(fromPackVersions);
  return prior.some(v => from.has(v));
}

/**
 * Evidence that a version-transition migration was skipped because an older launcher
 * advanced pack state without configMigration support.
 *
 * Requires durable priorPackVersions intersecting fromPackVersions — never treats
 * fresh null→current as a traversed source transition. Config-file shape alone is
 * not sufficient (fresh packs may already match target leafs).
 */
export async function evaluateMissedMigrationRecovery(
  migration: ManifestConfigMigration,
  ctx: MissedMigrationRecoveryContext
): Promise<MissedMigrationRecoveryOutcome> {
  const applied = new Set(ctx.state.appliedConfigMigrations ?? []);
  if (applied.has(migration.id)) {
    return { kind: "skip", reason: "already_applied" };
  }

  if (!migration.fromPackVersions?.length) {
    return { kind: "skip", reason: "not_transition_migration" };
  }

  const current = ctx.state.installedPackVersion;
  if (!current || migration.fromPackVersions.includes(current)) {
    return { kind: "skip", reason: "still_on_source_version" };
  }

  if (!hasPriorPackTransitionEvidence(ctx.state, migration.fromPackVersions)) {
    return { kind: "skip", reason: "no_transition_evidence" };
  }

  if (!releaseIdentityMatches(ctx.state, ctx.resolved)) {
    return { kind: "skip", reason: "release_identity_mismatch" };
  }

  const manifestMigration = findManifestMigration(ctx.resolved, migration.id);
  if (!manifestMigration) {
    return { kind: "skip", reason: "migration_not_in_manifest" };
  }

  const abs = await resolveSafeInstancePath(ctx.paths, migration.configPath);
  let rawText: string;
  try {
    rawText = await readFile(abs, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "skip", reason: "target_file_absent" };
    }
    throw new LauncherError(ErrorCode.CONFIG_MIGRATION_FAILED, "failed to read recovery target", {
      migrationId: migration.id,
      configPath: migration.configPath,
      cause: e instanceof Error ? e.message : String(e)
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { kind: "reject", reason: "malformed_json" };
  }
  if (!isPlainObject(parsed)) {
    return { kind: "reject", reason: "unsafe_target" };
  }

  let absentLeaves = 0;
  let convergedLeaves = 0;
  for (const entry of migration.set) {
    const before = getAtPath(parsed, entry.path);
    if (before === undefined) {
      absentLeaves++;
      continue;
    }
    if (Object.is(before, entry.value)) {
      convergedLeaves++;
      continue;
    }
    return { kind: "reject", reason: "user_modified_leaf" };
  }

  // With transition evidence: absent leaves need patch; all converged → record-only.
  if (absentLeaves > 0 || convergedLeaves === migration.set.length) {
    return { kind: "eligible", migration: manifestMigration };
  }

  return { kind: "skip", reason: "no_missed_evidence" };
}

export async function planMissedConfigMigrationRecoveries(
  ctx: MissedMigrationRecoveryContext
): Promise<ManifestConfigMigration[]> {
  const migrations = ctx.resolved.clientManifest.configMigrations ?? [];
  const eligible: ManifestConfigMigration[] = [];

  for (const migration of migrations) {
    const outcome = await evaluateMissedMigrationRecovery(migration, ctx);
    if (outcome.kind === "eligible") {
      eligible.push(outcome.migration);
    } else if (outcome.kind === "reject") {
      throw new LauncherError(ErrorCode.CONFIG_MIGRATION_FAILED, "missed migration recovery rejected", {
        migrationId: migration.id,
        reason: outcome.reason
      });
    }
  }

  return eligible;
}

/**
 * Apply one-shot recovery for migrations missed by an older launcher build.
 * Idempotent: records migration id even when leafs already match target.
 */
export async function reconcileMissedConfigMigrations(
  ctx: MissedMigrationRecoveryContext
): Promise<MissedMigrationRecoveryResult | null> {
  const planned = await planMissedConfigMigrationRecoveries(ctx);
  if (planned.length === 0) return null;

  const appliedIds: string[] = [];
  let files = ctx.state.files;

  for (const migration of planned) {
    const patched = await patchConfigMigrationFile({
      migration,
      paths: ctx.paths,
      managedFiles: files,
      missingFile: "fail"
    });
    files = patched.files;
    appliedIds.push(migration.id);
  }

  const mergedApplied = [...(ctx.state.appliedConfigMigrations ?? [])];
  for (const id of appliedIds) {
    if (!mergedApplied.includes(id)) mergedApplied.push(id);
  }

  return {
    appliedIds,
    files,
    nextState: {
      ...ctx.state,
      files,
      appliedConfigMigrations: mergedApplied,
      updatedAt: new Date().toISOString()
    }
  };
}
