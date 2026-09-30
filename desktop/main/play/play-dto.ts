import type { PlayLifecycleState, PlayStatusDto, UiError } from "../../shared/contract.js";
import { toUiError } from "../../shared/validate.js";

const STATES = new Set<PlayLifecycleState>([
  "UNAVAILABLE",
  "READY",
  "LAUNCHING",
  "RUNNING",
  "EXITED",
  "ERROR",
  "RECOVERY_REQUIRED"
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function boundedString(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (!t || t.length > max || t.includes("\0")) return undefined;
  return t;
}

export function normalizePlayStatus(raw: unknown): PlayStatusDto {
  if (!isPlainObject(raw)) throw toUiError("IPC_INVALID_RESPONSE", "errors.ipc.invalid_response");
  const state = raw.state;
  if (typeof state !== "string" || !STATES.has(state as PlayLifecycleState)) {
    throw toUiError("IPC_INVALID_RESPONSE", "errors.ipc.invalid_response");
  }
  const dto: PlayStatusDto = { state: state as PlayLifecycleState };
  const messageKey = boundedString(raw.messageKey, 128);
  const phaseKey = boundedString(raw.phaseKey, 128);
  const minecraftUsername = boundedString(raw.minecraftUsername, 64);
  const accountId = boundedString(raw.accountId, 128);
  if (messageKey) (dto as { messageKey?: string }).messageKey = messageKey;
  if (phaseKey) (dto as { phaseKey?: string }).phaseKey = phaseKey;
  if (minecraftUsername) (dto as { minecraftUsername?: string }).minecraftUsername = minecraftUsername;
  if (accountId) (dto as { accountId?: string }).accountId = accountId;
  if (raw.lastExitCode === null) (dto as { lastExitCode?: null }).lastExitCode = null;
  else if (typeof raw.lastExitCode === "number" && Number.isFinite(raw.lastExitCode)) {
    (dto as { lastExitCode?: number }).lastExitCode = Math.trunc(raw.lastExitCode);
  }
  if (isPlainObject(raw.error)) {
    const code = boundedString(raw.error.code, 128);
    const mk = boundedString(raw.error.messageKey, 128);
    if (code && mk) {
      (dto as { error?: UiError }).error = { code, messageKey: mk };
    }
  }
  // Strip forbidden leakage
  const json = JSON.stringify(dto);
  if (
    /accessToken|refreshToken|xstsToken|minecraftAccessToken|argfile|java\.exe|\\\\Users\\/i.test(
      json
    )
  ) {
    throw toUiError("IPC_INVALID_RESPONSE", "errors.ipc.invalid_response");
  }
  return dto;
}

export function tryNormalizePlayStatusEvent(raw: unknown): PlayStatusDto | null {
  try {
    return normalizePlayStatus(raw);
  } catch {
    return null;
  }
}

export function assertEmptyPlayPayload(raw: unknown): void {
  if (raw === undefined || raw === null) return;
  if (isPlainObject(raw) && Object.keys(raw).length === 0) return;
  throw toUiError("IPC_INVALID_PAYLOAD", "errors.ipc.invalid_payload");
}

export function assertSimulateExitPayload(raw: unknown): { exitCode: number } {
  if (raw === undefined || raw === null || (isPlainObject(raw) && Object.keys(raw).length === 0)) {
    return { exitCode: 0 };
  }
  if (!isPlainObject(raw)) throw toUiError("IPC_INVALID_PAYLOAD", "errors.ipc.invalid_payload");
  const keys = Object.keys(raw);
  if (keys.some((k) => k !== "exitCode")) {
    throw toUiError("IPC_INVALID_PAYLOAD", "errors.ipc.invalid_payload");
  }
  if (raw.exitCode === undefined) return { exitCode: 0 };
  if (typeof raw.exitCode !== "number" || !Number.isFinite(raw.exitCode)) {
    throw toUiError("IPC_INVALID_PAYLOAD", "errors.ipc.invalid_payload");
  }
  return { exitCode: Math.trunc(raw.exitCode) };
}
