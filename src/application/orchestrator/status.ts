import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import type { TrustedResolvedRelease } from "../../core/resolve/index.js";
import { resolveLatestRelease } from "../../core/resolve/index.js";
import { DEFAULT_PRODUCT_BASE } from "../../distribution/urls/index.js";
import { InstancePaths } from "../../instance/layout/index.js";
import {
  InstanceStateStore,
  createEmptyInstanceState,
  type InstanceState
} from "../../instance/state/instanceState.js";
import { auditInstance } from "../../instance/audit/index.js";
import { inspectInstanceLock } from "../../instance/lock/index.js";
import type {
  InstanceStatusCode,
  InstanceStatusReport,
  OrchestratorDependencies,
  OrchestratorRequestBase
} from "./types.js";
import { createOperationId, emitOperationProgress, phaseProgress } from "./progress.js";
import { isRiskyOrphanPhase } from "./recoveryGate.js";
import { scanTransactions } from "./transaction.js";
import { evaluateMissedMigrationRecovery } from "../../instance/configMigration/missedRecovery.js";
import { writeFileAtomic, ensureDir } from "../../download/fs/index.js";
import path from "node:path";
import { unlink } from "node:fs/promises";

export { peekInstanceLock, inspectInstanceLock } from "../../instance/lock/index.js";

/** Instance-local diagnostic snapshot written only while status is non-READY. */
export const LAST_NON_READY_STATUS_FILE = "last-non-ready-status.json";

export function lastNonReadyStatusPath(paths: InstancePaths): string {
  return path.join(paths.launcherDir(), LAST_NON_READY_STATUS_FILE);
}

export function isInstalledState(state: InstanceState): boolean {
  return (
    typeof state.installedPackVersion === "string" &&
    state.installedPackVersion.length > 0 &&
    typeof state.installedReleaseSequence === "number" &&
    Number.isInteger(state.installedReleaseSequence)
  );
}

export async function loadInstanceStateSafe(paths: InstancePaths): Promise<
  | { ok: true; state: InstanceState }
  | { ok: false; code: "CORRUPT" }
> {
  try {
    const state = await new InstanceStateStore(paths).load();
    return { ok: true, state };
  } catch (e) {
    if (LauncherError.isLauncherError(e) && e.code === ErrorCode.CORRUPT_STATE) {
      return { ok: false, code: "CORRUPT" };
    }
    throw e;
  }
}

/**
 * Observational STATUS — read-only.
 * Never deletes transactions or clears locks.
 *
 * Order: inspect lock → if LIVE return BUSY → else strict transaction scan → state/resolve.
 * Safe orphan cleanup is exclusive to mutating flows under InstanceLock.
 */
export async function inspectInstanceStatus(
  req: OrchestratorRequestBase,
  deps: OrchestratorDependencies,
  opts?: { skipLockCheck?: boolean }
): Promise<InstanceStatusReport> {
  const operationId = deps.createOperationId?.() ?? createOperationId();
  const emitter = deps.emitter;
  emitOperationProgress(emitter, phaseProgress(operationId, "status", "RESOLVING"));

  const paths = new InstancePaths(req.instancePath);
  const productBase = req.productBase ?? DEFAULT_PRODUCT_BASE;

  const lock = await inspectInstanceLock(paths);
  if (!opts?.skipLockCheck) {
    if (lock.kind === "LIVE") {
      return {
        operationId,
        operation: "status",
        status: "BUSY",
        channel: req.channel,
        installedVersion: null,
        installedSequence: null,
        latestVersion: null,
        latestSequence: null,
        findings: ["LOCK_PRESENT"],
        lockPresent: true,
        orphanTransaction: false
      };
    }
    if (lock.kind === "MALFORMED") {
      return {
        operationId,
        operation: "status",
        status: "RECOVERY_REQUIRED",
        channel: req.channel,
        installedVersion: null,
        installedSequence: null,
        latestVersion: null,
        latestSequence: null,
        findings: ["LOCK_MALFORMED"],
        lockPresent: true,
        orphanTransaction: false
      };
    }
  } else if (lock.kind === "MALFORMED") {
    // Still fail closed on malformed lock even under exclusive hold.
    return {
      operationId,
      operation: "status",
      status: "RECOVERY_REQUIRED",
      channel: req.channel,
      installedVersion: null,
      installedSequence: null,
      latestVersion: null,
      latestSequence: null,
      findings: ["LOCK_MALFORMED"],
      lockPresent: true,
      orphanTransaction: false
    };
  }

  emitOperationProgress(emitter, phaseProgress(operationId, "status", "INSPECTING"));

  const findings: string[] = [];
  if (!opts?.skipLockCheck && lock.kind === "STALE") {
    findings.push("STALE_LOCK");
  }

  const scan = await scanTransactions(paths);
  const riskyOrphans = scan.orphans.filter((o) => isRiskyOrphanPhase(o.phase));
  const safeOrphans = scan.orphans.filter(
    (o) =>
      o.phase === "PLANNED" ||
      o.phase === "ACQUIRING" ||
      o.phase === "FAILED" ||
      o.phase === "ABANDONED"
  );
  const hasOrphanSignal =
    scan.corrupt.length > 0 || riskyOrphans.length > 0 || safeOrphans.length > 0;

  const loaded = await loadInstanceStateSafe(paths);
  const installedVersion =
    loaded.ok && isInstalledState(loaded.state) ? loaded.state.installedPackVersion : null;
  const installedSequence =
    loaded.ok && isInstalledState(loaded.state) ? loaded.state.installedReleaseSequence : null;

  if (scan.corrupt.length > 0) {
    findings.push("CORRUPT_TRANSACTION");
    return {
      operationId,
      operation: "status",
      status: "RECOVERY_REQUIRED",
      channel: req.channel,
      installedVersion,
      installedSequence,
      latestVersion: null,
      latestSequence: null,
      findings,
      lockPresent: lock.kind === "STALE",
      orphanTransaction: true
    };
  }

  if (riskyOrphans.length > 0) {
    findings.push("ORPHAN_TRANSACTION_RISKY");
    return {
      operationId,
      operation: "status",
      status: "RECOVERY_REQUIRED",
      channel: req.channel,
      installedVersion,
      installedSequence,
      latestVersion: null,
      latestSequence: null,
      findings,
      lockPresent: lock.kind === "STALE",
      orphanTransaction: true
    };
  }

  if (safeOrphans.length > 0) {
    findings.push("SAFE_ORPHAN_TX");
  }

  if (!loaded.ok) {
    findings.push("STATE_CORRUPT");
    return {
      operationId,
      operation: "status",
      status: "INCOMPATIBLE_STATE",
      channel: req.channel,
      installedVersion: null,
      installedSequence: null,
      latestVersion: null,
      latestSequence: null,
      findings,
      lockPresent: lock.kind === "STALE",
      orphanTransaction: hasOrphanSignal
    };
  }

  const resolved = await resolveLatestRelease({
    channel: req.channel,
    productBase,
    http: deps.http,
    trust: deps.trust,
    antiRollbackState: await deps.antiRollbackStore.load(),
    ...(req.signal ? { signal: req.signal } : {})
  });

  const latestVersion = resolved.release.release.packVersion;
  const latestSequence = resolved.candidate.releaseSequence;

  if (!isInstalledState(loaded.state)) {
    emitOperationProgress(emitter, phaseProgress(operationId, "status", "DONE"));
    findings.push("NO_INSTANCE_STATE");
    return {
      operationId,
      operation: "status",
      status: "NOT_INSTALLED",
      channel: req.channel,
      installedVersion: null,
      installedSequence: null,
      latestVersion,
      latestSequence,
      findings,
      lockPresent: lock.kind === "STALE",
      orphanTransaction: safeOrphans.length > 0
    };
  }

  const audit = await auditInstance({
    resolved,
    paths,
    ...(emitter ? { emitter } : {})
  });
  let needsRepair = false;
  for (const f of audit.findings) {
    if (f.status === "MISSING" || f.status === "CORRUPT" || f.status === "STALE_MANAGED") {
      needsRepair = true;
      findings.push(`${f.status}:${f.kind}`);
    } else if (f.status === "UNMANAGED") {
      findings.push("UNMANAGED_EXTRA");
    } else if (f.status === "PRESERVED") {
      findings.push("CONFIG_PRESERVED");
    }
  }

  const sameRelease =
    installedVersion === latestVersion &&
    installedSequence === latestSequence &&
    loaded.state.installedReleaseSha256 === resolved.candidate.releaseSha256;

  const missedMigrationNotes: string[] = [];
  if (sameRelease && !needsRepair) {
    try {
      const migrations = resolved.clientManifest.configMigrations ?? [];
      const eligibleIds: string[] = [];
      for (const migration of migrations) {
        const outcome = await evaluateMissedMigrationRecovery(migration, {
          state: loaded.state,
          resolved,
          paths
        });
        if (outcome.kind === "eligible") {
          eligibleIds.push(migration.id);
          findings.push(`MISSED_CONFIG_MIGRATION:${migration.id}`);
        } else if (outcome.kind === "reject") {
          throw new LauncherError(ErrorCode.CONFIG_MIGRATION_FAILED, "missed migration recovery rejected", {
            migrationId: migration.id,
            reason: outcome.reason
          });
        } else {
          missedMigrationNotes.push(`${migration.id}:${outcome.reason}`);
        }
      }
      if (eligibleIds.length > 0) {
        needsRepair = true;
      }
    } catch (e) {
      if (LauncherError.isLauncherError(e) && e.code === ErrorCode.CONFIG_MIGRATION_FAILED) {
        needsRepair = true;
        findings.push("MISSED_CONFIG_MIGRATION_REJECTED");
        missedMigrationNotes.push(
          `reject:${typeof e.details?.reason === "string" ? e.details.reason : "CONFIG_MIGRATION_FAILED"}`
        );
      } else {
        throw e;
      }
    }
  }

  let status: InstanceStatusCode;
  if (!sameRelease) {
    status = "UPDATE_AVAILABLE";
    findings.push("RELEASE_BEHIND");
  } else if (needsRepair) {
    status = "REPAIR_REQUIRED";
  } else {
    status = "READY";
  }

  // Retain exact non-READY reason for the next fresh E2E (instance-local, not chatty logs).
  // READY clears any prior snapshot so stale REPAIR/UPDATE evidence cannot linger.
  const snapshotPath = lastNonReadyStatusPath(paths);
  if (status !== "READY") {
    try {
      await ensureDir(paths.launcherDir());
      await writeFileAtomic(
        snapshotPath,
        JSON.stringify(
          {
            at: new Date().toISOString(),
            status,
            findings: [...findings],
            missedMigrationNotes,
            installedPackVersion: loaded.state.installedPackVersion,
            installedReleaseSequence: loaded.state.installedReleaseSequence,
            priorPackVersions: loaded.state.priorPackVersions ?? [],
            appliedConfigMigrations: loaded.state.appliedConfigMigrations ?? []
          },
          null,
          2
        ) + "\n"
      );
    } catch {
      // Snapshot is diagnostic-only; never fail status on write errors.
    }
  } else {
    try {
      await unlink(snapshotPath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        // Ignore clear failures — status remains authoritative.
      }
    }
  }

  emitOperationProgress(emitter, phaseProgress(operationId, "status", "DONE"));
  return {
    operationId,
    operation: "status",
    status,
    channel: req.channel,
    installedVersion,
    installedSequence,
    latestVersion,
    latestSequence,
    findings,
    lockPresent: lock.kind === "STALE",
    orphanTransaction: safeOrphans.length > 0
  };
}

export { createEmptyInstanceState };
