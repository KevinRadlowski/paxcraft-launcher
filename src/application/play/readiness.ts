import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import type { InstanceStatusCode } from "../orchestrator/types.js";
import { inspectInstanceStatus } from "../orchestrator/status.js";
import type { OrchestratorDependencies } from "../orchestrator/types.js";
import type { PlayDependencies, PlayRequest } from "./types.js";

/**
 * Map 0.5A observational status → PLAY gate errors.
 * Never mutates instance / transactions.
 */
export function mapStatusToPlayError(status: InstanceStatusCode): LauncherError | null {
  switch (status) {
    case "NOT_INSTALLED":
      return new LauncherError(ErrorCode.PLAY_INSTALL_REQUIRED, "instance not installed", {
        status
      });
    case "UPDATE_AVAILABLE":
      return new LauncherError(ErrorCode.PLAY_UPDATE_REQUIRED, "update available; refuse silent update", {
        status
      });
    case "REPAIR_REQUIRED":
      return new LauncherError(ErrorCode.PLAY_REPAIR_REQUIRED, "repair required before play", {
        status
      });
    case "RECOVERY_REQUIRED":
      return new LauncherError(
        ErrorCode.INSTANCE_RECOVERY_REQUIRED,
        "instance recovery required before play",
        { status }
      );
    case "BUSY":
      return new LauncherError(ErrorCode.INSTANCE_BUSY, "instance busy", { status });
    case "INCOMPATIBLE_STATE":
      return new LauncherError(ErrorCode.INSTANCE_STATE_INVALID, "instance state invalid", {
        status
      });
    case "READY":
      return null;
    default:
      return new LauncherError(ErrorCode.INSTANCE_STATE_INVALID, "unknown instance status", {
        status
      });
  }
}

export async function assertPlayReadiness(
  req: PlayRequest,
  deps: PlayDependencies
): Promise<{
  packVersion: string;
  releaseSequence: number;
  installedVersion: string;
  installedSequence: number;
  latestVersion: string;
  latestSequence: number;
}> {
  const orchDeps: OrchestratorDependencies = {
    http: deps.http,
    trust: deps.trust,
    artefactSource: deps.artefactSource ?? {
      async open() {
        throw new LauncherError(ErrorCode.INTERNAL_ERROR, "artefactSource not configured");
      }
    },
    antiRollbackStore: deps.antiRollbackStore,
    antiRollbackState: deps.antiRollbackState,
    ...(deps.emitter ? { emitter: deps.emitter } : {}),
    ...(deps.createOperationId ? { createOperationId: deps.createOperationId } : {})
  };

  const report = await inspectInstanceStatus(
    {
      channel: req.channel,
      instancePath: req.instancePath,
      ...(req.productBase ? { productBase: req.productBase } : {}),
      ...(req.signal ? { signal: req.signal } : {})
    },
    orchDeps,
    { skipLockCheck: true }
  );

  const err = mapStatusToPlayError(report.status);
  if (err) {
    const details: Record<string, unknown> = { ...err.details };
    if (report.installedVersion) details.installedVersion = report.installedVersion;
    if (report.latestVersion) details.latestVersion = report.latestVersion;
    throw new LauncherError(err.code, err.message, details);
  }

  if (
    report.installedVersion == null ||
    report.installedSequence == null ||
    report.latestVersion == null ||
    report.latestSequence == null
  ) {
    throw new LauncherError(ErrorCode.INSTANCE_STATE_INVALID, "READY status missing identities", {});
  }

  if (
    report.installedVersion !== report.latestVersion ||
    report.installedSequence !== report.latestSequence
  ) {
    throw new LauncherError(ErrorCode.PLAY_UPDATE_REQUIRED, "installed behind trusted tip", {
      installedVersion: report.installedVersion,
      latestVersion: report.latestVersion
    });
  }

  return {
    packVersion: report.installedVersion,
    releaseSequence: report.installedSequence,
    installedVersion: report.installedVersion,
    installedSequence: report.installedSequence,
    latestVersion: report.latestVersion,
    latestSequence: report.latestSequence
  };
}
