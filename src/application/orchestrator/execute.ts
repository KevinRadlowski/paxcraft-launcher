import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import { resolveLatestRelease, type TrustedResolvedRelease } from "../../core/resolve/index.js";
import { DEFAULT_PRODUCT_BASE } from "../../distribution/urls/index.js";
import { applyInstallation } from "../../instance/apply/index.js";
import { reconcileMissedConfigMigrations } from "../../instance/configMigration/missedRecovery.js";
import { applyFirstRunSeeds } from "../../instance/firstRun/seed.js";
import { InstanceStateStore, type InstanceState } from "../../instance/state/instanceState.js";
import type { InstallationPlan } from "../../instance/plan/index.js";
import { auditInstance } from "../../instance/audit/index.js";
import { InstancePaths } from "../../instance/layout/index.js";
import { InstanceLock } from "../../instance/lock/index.js";
import { defaultRuntimeRoot } from "../../instance/paths/index.js";
import type {
  InstallRequest,
  OrchestratorDependencies,
  OperationResult,
  RepairRequest,
  UpdateRequest
} from "./types.js";
import { createOperationId, emitOperationProgress, phaseProgress } from "./progress.js";
import {
  OrchestratorTransaction,
  cleanupSafeOrphanTransactions,
  scanTransactions
} from "./transaction.js";
import { assertNoCorruptOrRiskyTransactions } from "./recoveryGate.js";
import { assertGameProcessNotActive } from "./gameGate.js";
import { isInstalledState, loadInstanceStateSafe } from "./status.js";
import { prepareMinecraftRuntime } from "./runtimePrep.js";

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new LauncherError(ErrorCode.OPERATION_ABORTED, "operation aborted", {});
  }
}

function mapLockError(e: unknown): never {
  if (LauncherError.isLauncherError(e) && e.code === ErrorCode.INSTANCE_LOCKED) {
    throw new LauncherError(ErrorCode.INSTANCE_BUSY, "instance is busy", e.details);
  }
  throw e;
}

async function resolveTrusted(
  req: InstallRequest | UpdateRequest | RepairRequest,
  deps: OrchestratorDependencies
): Promise<TrustedResolvedRelease> {
  const antiRollbackState = await deps.antiRollbackStore.load();
  return resolveLatestRelease({
    channel: req.channel,
    productBase: req.productBase ?? DEFAULT_PRODUCT_BASE,
    http: deps.http,
    trust: deps.trust,
    antiRollbackState,
    ...(req.signal ? { signal: req.signal } : {})
  });
}

function summarizePlan(plan: InstallationPlan): {
  changedFiles: number;
  downloadedFiles: number;
  downloadedBytes: number;
} {
  const downloadedFiles = plan.summary.download + plan.summary.replace;
  let downloadedBytes = 0;
  for (const e of plan.entries) {
    if (e.action === "DOWNLOAD" || e.action === "REPLACE") {
      downloadedBytes += Math.max(0, e.expectedSize);
    }
  }
  const changedFiles =
    plan.summary.download + plan.summary.replace + plan.summary.deleteManaged;
  return { changedFiles, downloadedFiles, downloadedBytes };
}

async function maybePrepareRuntime(
  req: InstallRequest | UpdateRequest | RepairRequest,
  deps: OrchestratorDependencies,
  resolved: TrustedResolvedRelease,
  operationId: string,
  operation: "install" | "update" | "repair"
): Promise<{ downloadedFiles: number; downloadedBytes: number }> {
  if (req.skipRuntimePrep === true) {
    return { downloadedFiles: 0, downloadedBytes: 0 };
  }
  if (!deps.runtimeSources || !deps.runtimeByteSource) {
    throw new LauncherError(
      ErrorCode.INTERNAL_ERROR,
      "runtimeSources and runtimeByteSource required unless skipRuntimePrep"
    );
  }
  emitOperationProgress(
    deps.emitter,
    phaseProgress(operationId, operation, "PREPARING_RUNTIME")
  );
  const runtimeRoot = req.runtimePath ?? defaultRuntimeRoot();
  const prep = await prepareMinecraftRuntime({
    resolved,
    runtimeRoot,
    sources: deps.runtimeSources,
    byteSource: deps.runtimeByteSource,
    http: deps.http,
    ...(deps.platform ? { platform: deps.platform } : {}),
    ...(deps.emitter ? { emitter: deps.emitter } : {}),
    ...(req.signal ? { signal: req.signal } : {})
  });
  return {
    downloadedFiles: prep.downloadedFiles,
    downloadedBytes: prep.downloadedBytes
  };
}

async function commitRepairSideState(
  paths: InstancePaths,
  nextState: InstanceState,
  deps: OrchestratorDependencies,
  operationId: string,
  operation: "repair" | "update",
  resolved: TrustedResolvedRelease,
  changedFiles: number
): Promise<OperationResult> {
  const stateStore = new InstanceStateStore(paths);
  await stateStore.saveAtomic(nextState);
  deps.emitter?.emit("STATE_WRITTEN", {
    packVersion: nextState.installedPackVersion,
    releaseSequence: nextState.installedReleaseSequence,
    fileCount: nextState.files.length
  });
  emitOperationProgress(deps.emitter, phaseProgress(operationId, operation, "DONE"));
  return {
    operationId,
    operation,
    outcome: "SUCCESS",
    releaseVersion: resolved.release.release.packVersion,
    releaseSequence: resolved.candidate.releaseSequence,
    changedFiles,
    downloadedFiles: 0,
    downloadedBytes: 0
  };
}

async function tryRepairSideEffectsOnly(
  deps: OrchestratorDependencies,
  operationId: string,
  operation: "repair" | "update",
  paths: InstancePaths,
  state: Awaited<ReturnType<typeof loadInstanceStateSafe>> & { ok: true },
  resolved: TrustedResolvedRelease,
  tx: OrchestratorTransaction
): Promise<OperationResult | null> {
  let working = state.state;
  let changed = 0;

  const recovered = await reconcileMissedConfigMigrations({
    state: working,
    resolved,
    paths
  });
  if (recovered) {
    working = recovered.nextState;
    changed += recovered.appliedIds.length;
  }

  const seeded = await applyFirstRunSeeds({
    paths,
    state: working,
    managedFiles: working.files
  });
  if (seeded) {
    working = seeded.nextState;
    changed += seeded.appliedSeedIds.length;
  }

  if (changed === 0) return null;

  await tx.setPhase("COMMITTING", "repair-side-effects");
  emitOperationProgress(deps.emitter, phaseProgress(operationId, operation, "COMMITTING"));
  const result = await commitRepairSideState(
    paths,
    working,
    deps,
    operationId,
    operation,
    resolved,
    changed
  );
  await tx.setPhase("COMMITTED", "repair-side-effects");
  await tx.cleanup();
  return result;
}

async function verifyAgainstResolved(
  resolved: TrustedResolvedRelease,
  paths: InstancePaths,
  deps: OrchestratorDependencies
): Promise<void> {
  if (deps.hooks?.beforeFinalAudit) {
    await deps.hooks.beforeFinalAudit();
  }
  const audit = await auditInstance({
    resolved,
    paths,
    ...(deps.emitter ? { emitter: deps.emitter } : {})
  });
  for (const f of audit.findings) {
    if (f.status === "MISSING" || f.status === "CORRUPT") {
      throw new LauncherError(ErrorCode.OPERATION_VERIFY_FAILED, "post-apply audit failed", {
        finding: f.status,
        kind: f.kind
      });
    }
  }
}

/**
 * Mutating operations own InstanceLock for the full critical section:
 * acquire → inspect → resolve → plan → runtime → apply files → audit → commit state → cleanup → release
 *
 * Pack downloads stage under launcher/tmp (DownloadEngine); transaction journal tracks orchestration only.
 */
async function runMutatingOperation(
  req: InstallRequest | UpdateRequest | RepairRequest,
  deps: OrchestratorDependencies,
  gate: (args: {
    stateOk: boolean;
    installed: boolean;
    resolved: TrustedResolvedRelease;
    installedVersion: string | null;
    installedSequence: number | null;
  }) => void
): Promise<OperationResult> {
  const operation = req.operation;
  const operationId = deps.createOperationId?.() ?? createOperationId();
  const paths = new InstancePaths(req.instancePath);
  const instanceLock = new InstanceLock(paths);

  emitOperationProgress(deps.emitter, phaseProgress(operationId, operation, "INSPECTING"));

  let lease: Awaited<ReturnType<InstanceLock["acquire"]>> | null = null;
  try {
    lease = await instanceLock.acquire(operation, {
      forceStale: req.forceStaleLock === true,
      owner: `orchestrator:${operationId}`
    });
  } catch (e) {
    mapLockError(e);
  }

  let tx: OrchestratorTransaction | null = null;

  try {
    // Refuse mutation while Minecraft is running / launch reserved.
    await assertGameProcessNotActive(paths);

    // Exclusive cleanup authority: only under InstanceLock.
    await cleanupSafeOrphanTransactions(paths);
    assertNoCorruptOrRiskyTransactions(await scanTransactions(paths));

    let loaded = await loadInstanceStateSafe(paths);
    if (!loaded.ok) {
      throw new LauncherError(ErrorCode.INSTANCE_STATE_INVALID, "instance state corrupt", {});
    }

    emitOperationProgress(deps.emitter, phaseProgress(operationId, operation, "RESOLVING"));
    throwIfAborted(req.signal);
    const resolved = await resolveTrusted(req, deps);

    // Re-read state after resolve (network) while still holding the lock.
    loaded = await loadInstanceStateSafe(paths);
    if (!loaded.ok) {
      throw new LauncherError(ErrorCode.INSTANCE_STATE_INVALID, "instance state corrupt", {});
    }

    gate({
      stateOk: true,
      installed: isInstalledState(loaded.state),
      resolved,
      installedVersion: loaded.state.installedPackVersion,
      installedSequence: loaded.state.installedReleaseSequence
    });

    tx = await OrchestratorTransaction.create(paths, {
      operation,
      channel: req.channel,
      packVersion: resolved.release.release.packVersion,
      releaseSequence: resolved.candidate.releaseSequence
    });
    await tx.setReleaseIdentity(
      resolved.release.release.packVersion,
      resolved.candidate.releaseSequence
    );
    await tx.setPhase("ACQUIRING", "planning");
    emitOperationProgress(deps.emitter, phaseProgress(operationId, operation, "PLANNING"));

    if (deps.hooks?.duringRuntimePrep) {
      // Pause point while exclusive lock is held (race tests).
      await deps.hooks.duringRuntimePrep();
    }

    const dry = await applyInstallation({
      resolved,
      paths,
      source: deps.artefactSource,
      dryRun: true,
      http: deps.http,
      ...(req.signal ? { signal: req.signal } : {}),
      ...(deps.emitter ? { emitter: deps.emitter } : {})
    });
    const drySummary = summarizePlan(dry.plan);

    const packNoop =
      (operation === "update" || operation === "repair") &&
      drySummary.changedFiles === 0 &&
      loaded.state.installedPackVersion === resolved.release.release.packVersion &&
      loaded.state.installedReleaseSequence === resolved.candidate.releaseSequence;

    if (packNoop && req.skipRuntimePrep === true) {
      if (operation === "repair" || operation === "update") {
        const sideOnly = await tryRepairSideEffectsOnly(
          deps,
          operationId,
          operation,
          paths,
          loaded,
          resolved,
          tx
        );
        if (sideOnly) {
          tx = null;
          return sideOnly;
        }
      }
      await tx.setPhase("COMMITTED", "noop");
      await tx.cleanup();
      tx = null;
      emitOperationProgress(deps.emitter, phaseProgress(operationId, operation, "DONE"));
      return {
        operationId,
        operation,
        outcome: "NOOP",
        releaseVersion: resolved.release.release.packVersion,
        releaseSequence: resolved.candidate.releaseSequence,
        changedFiles: 0,
        downloadedFiles: 0,
        downloadedBytes: 0
      };
    }

    const runtimeStats = await maybePrepareRuntime(req, deps, resolved, operationId, operation);

    if (packNoop && runtimeStats.downloadedFiles === 0) {
      if (operation === "repair" || operation === "update") {
        const sideOnly = await tryRepairSideEffectsOnly(
          deps,
          operationId,
          operation,
          paths,
          loaded,
          resolved,
          tx
        );
        if (sideOnly) {
          tx = null;
          return sideOnly;
        }
      }
      await tx.setPhase("COMMITTED", "noop");
      await tx.cleanup();
      tx = null;
      emitOperationProgress(deps.emitter, phaseProgress(operationId, operation, "DONE"));
      return {
        operationId,
        operation,
        outcome: "NOOP",
        releaseVersion: resolved.release.release.packVersion,
        releaseSequence: resolved.candidate.releaseSequence,
        changedFiles: 0,
        downloadedFiles: 0,
        downloadedBytes: 0
      };
    }

    await tx.setPhase("APPLYING", "filesystem");
    emitOperationProgress(deps.emitter, phaseProgress(operationId, operation, "DOWNLOADING"));
    throwIfAborted(req.signal);

    const applied = await applyInstallation({
      resolved,
      paths,
      source: deps.artefactSource,
      dryRun: false,
      deferStateCommit: true,
      lockLease: lease!,
      reconcileMissedMigrations: operation === "repair",
      http: deps.http,
      ...(req.signal ? { signal: req.signal } : {}),
      ...(deps.emitter ? { emitter: deps.emitter } : {})
    });

    if (!applied.pending) {
      throw new LauncherError(ErrorCode.INTERNAL_ERROR, "deferred apply missing pending commit");
    }

    if (deps.hooks?.afterFilesystemApply) {
      await deps.hooks.afterFilesystemApply();
    }

    const mid = await loadInstanceStateSafe(paths);
    if (
      mid.ok &&
      mid.state.installedPackVersion !== applied.pending.previousState.installedPackVersion
    ) {
      throw new LauncherError(
        ErrorCode.INTERNAL_ERROR,
        "state was committed before final audit (invariant broken)"
      );
    }

    await tx.setPhase("VERIFYING", "audit");
    emitOperationProgress(deps.emitter, phaseProgress(operationId, operation, "VERIFYING"));
    await verifyAgainstResolved(resolved, paths, deps);

    await tx.setPhase("COMMITTING", "state");
    emitOperationProgress(deps.emitter, phaseProgress(operationId, operation, "COMMITTING"));

    await applied.pending.commit({
      antiRollbackStore: deps.antiRollbackStore,
      antiRollbackState: await deps.antiRollbackStore.load(),
      ...(deps.emitter ? { emitter: deps.emitter } : {})
    });

    await tx.setPhase("COMMITTED", "success");
    emitOperationProgress(deps.emitter, phaseProgress(operationId, operation, "CLEANUP"));
    await tx.cleanup();
    tx = null;
    emitOperationProgress(deps.emitter, phaseProgress(operationId, operation, "DONE"));

    const packStats = summarizePlan(applied.plan);
    return {
      operationId,
      operation,
      outcome: "SUCCESS",
      releaseVersion: resolved.release.release.packVersion,
      releaseSequence: resolved.candidate.releaseSequence,
      changedFiles: packStats.changedFiles,
      downloadedFiles: packStats.downloadedFiles + runtimeStats.downloadedFiles,
      downloadedBytes: packStats.downloadedBytes + runtimeStats.downloadedBytes
    };
  } catch (e) {
    if (tx) {
      try {
        const risky =
          tx.phase === "APPLYING" || tx.phase === "VERIFYING" || tx.phase === "COMMITTING";
        if (!risky) {
          await tx.setPhase("FAILED", LauncherError.isLauncherError(e) ? e.code : "UNKNOWN");
        }
        // Risky phases stay as-is for RECOVERY_REQUIRED status.
      } catch {
        // best-effort
      }
    }
    deps.emitter?.emit("OPERATION_FAILED", {
      operationId,
      operation,
      errorCode: LauncherError.isLauncherError(e) ? e.code : "INTERNAL_ERROR"
    });
    throw e;
  } finally {
    if (lease) {
      try {
        await instanceLock.releaseLease(lease);
      } catch {
        // Never fall back to pid-only release() — would steal another same-pid lease.
        deps.emitter?.emit("OPERATION_FAILED", {
          operationId,
          operation,
          errorCode: ErrorCode.INSTANCE_LOCKED,
          lockCleanupFailed: true
        });
      }
    }
  }
}

export async function installInstance(
  req: InstallRequest,
  deps: OrchestratorDependencies
): Promise<OperationResult> {
  return runMutatingOperation(req, deps, ({ installed }) => {
    if (installed) {
      throw new LauncherError(
        ErrorCode.INSTANCE_ALREADY_INSTALLED,
        "instance already installed; use update or repair"
      );
    }
  });
}

export async function updateInstance(
  req: UpdateRequest,
  deps: OrchestratorDependencies
): Promise<OperationResult> {
  return runMutatingOperation(req, deps, ({ installed }) => {
    if (!installed) {
      throw new LauncherError(ErrorCode.INSTANCE_NOT_INSTALLED, "instance not installed");
    }
  });
}

/**
 * REPAIR restores integrity of the *installed* release when it matches channel tip.
 * Intentional limitation: outdated install + newer tip → INSTANCE_UPDATE_REQUIRED (no silent update).
 */
export async function repairInstance(
  req: RepairRequest,
  deps: OrchestratorDependencies
): Promise<OperationResult> {
  return runMutatingOperation(req, deps, ({ installed, resolved, installedVersion, installedSequence }) => {
    if (!installed) {
      throw new LauncherError(ErrorCode.INSTANCE_NOT_INSTALLED, "instance not installed");
    }
    const latestVersion = resolved.release.release.packVersion;
    const latestSequence = resolved.candidate.releaseSequence;
    if (installedVersion !== latestVersion || installedSequence !== latestSequence) {
      throw new LauncherError(
        ErrorCode.INSTANCE_UPDATE_REQUIRED,
        "repair refuses to change release; run update first",
        {
          installedVersion,
          installedSequence,
          latestVersion,
          latestSequence
        }
      );
    }
  });
}
