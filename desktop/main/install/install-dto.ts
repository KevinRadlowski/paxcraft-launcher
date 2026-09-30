import {
  SWEETCRAFT_SERVER_ADDRESS,
  type InstallActiveOperation,
  type InstallProgressDto,
  type InstallRecoverability,
  type LauncherStatusDto
} from "../../shared/contract.js";
import { normalizeLauncherStatus, toUiError } from "../../shared/validate.js";
import type { InstallStatusSnapshot } from "./install-types.js";

export function snapshotToStatusDto(
  snap: InstallStatusSnapshot,
  opts?: {
    activeOperation?: InstallActiveOperation;
    progress?: InstallProgressDto;
  }
): LauncherStatusDto {
  const installed = snap.installedVersion ?? undefined;
  const latest = snap.latestVersion ?? undefined;
  const raw: Record<string, unknown> = {
    readiness: snap.readiness,
    serverAddress: SWEETCRAFT_SERVER_ADDRESS,
    channel: snap.channel,
    recoverability: snap.recoverability,
    activeOperation: opts?.activeOperation ?? "IDLE"
  };
  if (installed) {
    raw.packVersion = installed;
    raw.installedVersion = installed;
  }
  if (latest) raw.latestVersion = latest;
  if (snap.messageKey) raw.messageKey = snap.messageKey;
  if (opts?.progress) raw.progress = opts.progress;
  return normalizeLauncherStatus(raw);
}

export function recoverabilityForReadiness(
  readiness: InstallStatusSnapshot["readiness"]
): InstallRecoverability {
  if (readiness === "RECOVERY_REQUIRED") return "BLOCKED";
  return "NONE";
}

export function assertEmptyInstallPayload(raw: unknown): void {
  if (raw === undefined || raw === null) return;
  if (typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw as object).length === 0) {
    return;
  }
  throw toUiError("IPC_INVALID_PAYLOAD", "errors.ipc.invalid_payload");
}
