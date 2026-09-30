import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import { InstancePaths } from "../../instance/layout/index.js";
import { InstanceLock } from "../../instance/lock/index.js";
import { applyUninstall } from "../../instance/uninstall/index.js";
import {
  cleanupSafeOrphanTransactions,
  scanTransactions
} from "./transaction.js";
import { assertGameProcessNotActive } from "./gameGate.js";
import { assertNoCorruptOrRiskyTransactions } from "./recoveryGate.js";
import { loadInstanceStateSafe } from "./status.js";
import { createOperationId, emitOperationProgress, phaseProgress } from "./progress.js";
import type { OrchestratorDependencies, OperationResult, UninstallRequest } from "./types.js";

function mapLockError(e: unknown): never {
  if (LauncherError.isLauncherError(e) && e.code === ErrorCode.INSTANCE_LOCKED) {
    throw new LauncherError(ErrorCode.INSTANCE_BUSY, "instance is busy", e.details);
  }
  throw e;
}

export async function uninstallInstance(
  req: UninstallRequest,
  deps: OrchestratorDependencies
): Promise<OperationResult> {
  const mode = req.mode ?? "SAFE";
  const operationId = deps.createOperationId?.() ?? createOperationId();
  const paths = new InstancePaths(req.instancePath);
  const instanceLock = new InstanceLock(paths);

  emitOperationProgress(deps.emitter, phaseProgress(operationId, "uninstall", "INSPECTING"));

  let lease: Awaited<ReturnType<InstanceLock["acquire"]>> | null = null;
  try {
    lease = await instanceLock.acquire("uninstall", {
      forceStale: req.forceStaleLock === true,
      owner: `orchestrator:${operationId}`
    });
  } catch (e) {
    mapLockError(e);
  }

  let releaseVersion = "";
  let releaseSequence = 0;

  try {
    await assertGameProcessNotActive(paths);
    await cleanupSafeOrphanTransactions(paths);
    const scan = await scanTransactions(paths);
    assertNoCorruptOrRiskyTransactions(scan);

    if (mode === "SAFE") {
      const loaded = await loadInstanceStateSafe(paths);
      if (!loaded.ok) {
        throw new LauncherError(ErrorCode.INSTANCE_STATE_INVALID, "instance state corrupt", {});
      }
      releaseVersion = loaded.state.installedPackVersion ?? "";
      releaseSequence = loaded.state.installedReleaseSequence ?? 0;
    } else {
      const loaded = await loadInstanceStateSafe(paths);
      if (loaded.ok) {
        releaseVersion = loaded.state.installedPackVersion ?? "";
        releaseSequence = loaded.state.installedReleaseSequence ?? 0;
      }
    }

    emitOperationProgress(deps.emitter, phaseProgress(operationId, "uninstall", "APPLYING"));

    const uninstallOpts: Parameters<typeof applyUninstall>[0] = {
      mode,
      paths,
      lockLease: lease ?? undefined
    };
    if (deps.emitter) {
      uninstallOpts.emitter = deps.emitter;
    }
    if (mode === "COMPLETE") {
      if (!req.launcherDataRoot?.trim()) {
        throw new LauncherError(ErrorCode.UNSAFE_PATH, "launcher data root required for complete uninstall");
      }
      uninstallOpts.launcherDataRoot = req.launcherDataRoot;
    }

    const result = await applyUninstall(uninstallOpts);

    emitOperationProgress(deps.emitter, phaseProgress(operationId, "uninstall", "COMMITTING"));
    emitOperationProgress(deps.emitter, phaseProgress(operationId, "uninstall", "CLEANUP"));
    emitOperationProgress(deps.emitter, phaseProgress(operationId, "uninstall", "DONE"));

    return {
      operationId,
      operation: "uninstall",
      outcome: result.outcome,
      releaseVersion,
      releaseSequence,
      changedFiles: result.removedFiles,
      downloadedFiles: 0,
      downloadedBytes: 0
    };
  } catch (e) {
    deps.emitter?.emit("OPERATION_FAILED", {
      operationId,
      operation: "uninstall",
      errorCode: LauncherError.isLauncherError(e) ? e.code : "UNKNOWN"
    });
    throw e;
  } finally {
    if (lease) {
      try {
        await instanceLock.releaseLease(lease);
      } catch {
        deps.emitter?.emit("OPERATION_FAILED", {
          operationId,
          operation: "uninstall",
          errorCode: ErrorCode.INSTANCE_LOCKED,
          lockCleanupFailed: true
        });
      }
    }
  }
}
