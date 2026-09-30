/** Lightweight runtime validators — no external schema dependency. */

import type {
  AccountSummaryDto,
  AppInfoDto,
  AuthState,
  IpcResult,
  LauncherReadiness,
  LauncherStatusDto,
  SettingsDto,
  UiError,
  UninstallMode
} from "./contract.js";
import { isIpcResult } from "./contract.js";

const READINESS = new Set<LauncherReadiness>([
  "NOT_INSTALLED",
  "READY",
  "UPDATE_AVAILABLE",
  "REPAIR_REQUIRED",
  "BUSY",
  "INCOMPATIBLE_STATE",
  "RECOVERY_REQUIRED",
  "UNKNOWN",
  "CHECKING",
  "ERROR",
  "LOCATION_UNAVAILABLE"
]);

const ACTIVE_OPS = new Set([
  "IDLE",
  "CHECKING",
  "INSTALLING",
  "UPDATING",
  "REPAIRING",
  "UNINSTALLING",
  "MOVING_INSTANCE"
]);

const RECOVERABILITY = new Set(["NONE", "BLOCKED", "AUTO_HANDLED"]);

const AUTH = new Set<AuthState>([
  "UNKNOWN",
  "SIGNED_OUT",
  "RESTORING",
  "AUTHENTICATED",
  "REAUTH_REQUIRED",
  "ERROR"
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype
  );
}

function boundedString(v: unknown, max = 256): string | null {
  if (typeof v !== "string") return null;
  if (v.length === 0 || v.length > max) return null;
  if (v.includes("\0")) return null;
  return v;
}

/** Strict instance path payload — validated path string only (PACK-10.1G). */
export function assertInstancePathPayload(raw: unknown): string {
  if (!isPlainObject(raw)) {
    throw toUiError("IPC_INVALID_PAYLOAD", "errors.ipc.invalid_payload");
  }
  const pathValue = boundedString(raw.path, 4096);
  if (!pathValue) {
    throw toUiError("IPC_INVALID_PAYLOAD", "errors.ipc.invalid_payload");
  }
  if (Object.keys(raw).length !== 1) {
    throw toUiError("IPC_INVALID_PAYLOAD", "errors.ipc.invalid_payload");
  }
  return pathValue;
}

/** Strict uninstall payload — mode enum only. */
export function assertUninstallPayload(raw: unknown): UninstallMode {
  if (!isPlainObject(raw)) {
    throw toUiError("IPC_INVALID_PAYLOAD", "errors.ipc.invalid_payload");
  }
  if (raw.mode !== "SAFE" && raw.mode !== "COMPLETE") {
    throw toUiError("IPC_INVALID_PAYLOAD", "errors.ipc.invalid_payload");
  }
  if (Object.keys(raw).length !== 1) {
    throw toUiError("IPC_INVALID_PAYLOAD", "errors.ipc.invalid_payload");
  }
  return raw.mode;
}

/** Reject non-empty invoke payloads for 0.6A read-only commands. */
export function assertEmptyInvokePayload(raw: unknown): void {
  if (raw === undefined || raw === null) return;
  if (isPlainObject(raw) && Object.keys(raw).length === 0) return;
  throw toUiError("IPC_INVALID_PAYLOAD", "errors.ipc.invalid_payload");
}

export function toUiError(code: string, messageKey: string, details?: UiError["details"]): UiError {
  return details ? { code, messageKey, details } : { code, messageKey };
}

export function normalizeUiError(e: unknown): UiError {
  if (isPlainObject(e) && typeof e.code === "string" && typeof e.messageKey === "string") {
    return toUiError(e.code.slice(0, 128), e.messageKey.slice(0, 128));
  }
  if (isPlainObject(e) && typeof e.code === "string") {
    return toUiError(e.code.slice(0, 128), "error.auth_error");
  }
  return toUiError("INTERNAL_ERROR", "errors.internal");
}

export function normalizeAppInfo(raw: unknown): AppInfoDto {
  if (!isPlainObject(raw)) throw toUiError("IPC_INVALID_RESPONSE", "errors.ipc.invalid_response");
  const name = boundedString(raw.name, 128);
  const version = boundedString(raw.version, 64);
  const platform = boundedString(raw.platform, 32);
  const environment = raw.environment === "production" ? "production" : "development";
  if (!name || !version || !platform) {
    throw toUiError("IPC_INVALID_RESPONSE", "errors.ipc.invalid_response");
  }
  const dto: AppInfoDto = { name, version, platform, environment };
  if (typeof raw.buildCommit === "string" && raw.buildCommit) {
    const buildCommit = boundedString(raw.buildCommit, 64);
    if (buildCommit) (dto as { buildCommit?: string }).buildCommit = buildCommit;
  }
  if (typeof raw.buildId === "string" && raw.buildId) {
    const buildId = boundedString(raw.buildId, 96);
    if (buildId) (dto as { buildId?: string }).buildId = buildId;
  }
  if (isPlainObject(raw.features)) {
    const features: {
      fakeAuthHarness?: boolean;
      fakeInstallHarness?: boolean;
      fakePlayHarness?: boolean;
    } = {};
    if (raw.features.fakeAuthHarness === true) features.fakeAuthHarness = true;
    if (raw.features.fakeInstallHarness === true) features.fakeInstallHarness = true;
    if (raw.features.fakePlayHarness === true) features.fakePlayHarness = true;
    if (features.fakeAuthHarness || features.fakeInstallHarness || features.fakePlayHarness) {
      (dto as { features?: typeof features }).features = features;
    }
  }
  return dto;
}

function normalizeProgressField(raw: unknown): LauncherStatusDto["progress"] | undefined {
  if (!isPlainObject(raw)) return undefined;
  const phase = boundedString(raw.phase, 64);
  if (!phase) return undefined;
  const operation =
    raw.operation === "install" ||
    raw.operation === "update" ||
    raw.operation === "repair" ||
    raw.operation === "uninstall" ||
    raw.operation === "status"
      ? raw.operation
      : "install";
  const indeterminate = raw.indeterminate === true;
  const progress: NonNullable<LauncherStatusDto["progress"]> = {
    phase: phase as NonNullable<LauncherStatusDto["progress"]>["phase"],
    operation,
    indeterminate
  };
  if (typeof raw.completedFiles === "number" && Number.isFinite(raw.completedFiles)) {
    (progress as { completedFiles?: number }).completedFiles = Math.floor(raw.completedFiles);
  }
  if (typeof raw.totalFiles === "number" && Number.isFinite(raw.totalFiles)) {
    (progress as { totalFiles?: number }).totalFiles = Math.floor(raw.totalFiles);
  }
  if (typeof raw.completedBytes === "number" && Number.isFinite(raw.completedBytes)) {
    (progress as { completedBytes?: number }).completedBytes = Math.floor(raw.completedBytes);
  }
  if (typeof raw.totalBytes === "number" && Number.isFinite(raw.totalBytes)) {
    (progress as { totalBytes?: number }).totalBytes = Math.floor(raw.totalBytes);
  }
  if (typeof raw.percent === "number" && Number.isFinite(raw.percent)) {
    (progress as { percent?: number }).percent = Math.min(
      100,
      Math.max(0, Math.floor(raw.percent))
    );
  }
  const label = boundedString(raw.currentItemLabel, 128);
  if (label && !label.includes("/") && !label.includes("\\") && !label.includes(":")) {
    (progress as { currentItemLabel?: string }).currentItemLabel = label;
  }
  if (typeof raw.elapsedMs === "number" && Number.isFinite(raw.elapsedMs) && raw.elapsedMs >= 0) {
    (progress as { elapsedMs?: number }).elapsedMs = Math.floor(raw.elapsedMs);
  }
  if (typeof raw.bytesPerSecond === "number" && Number.isFinite(raw.bytesPerSecond) && raw.bytesPerSecond > 0) {
    (progress as { bytesPerSecond?: number }).bytesPerSecond = raw.bytesPerSecond;
  }
  if (typeof raw.etaSeconds === "number" && Number.isFinite(raw.etaSeconds) && raw.etaSeconds > 0) {
    (progress as { etaSeconds?: number }).etaSeconds = Math.floor(raw.etaSeconds);
  }
  if (raw.metricScope === "download" || raw.metricScope === "files") {
    (progress as { metricScope?: "download" | "files" }).metricScope = raw.metricScope;
  }
  return progress;
}

export function normalizeLauncherStatus(raw: unknown): LauncherStatusDto {
  if (!isPlainObject(raw)) throw toUiError("IPC_INVALID_RESPONSE", "errors.ipc.invalid_response");
  const readiness = raw.readiness;
  if (typeof readiness !== "string" || !READINESS.has(readiness as LauncherReadiness)) {
    throw toUiError("IPC_INVALID_RESPONSE", "errors.ipc.invalid_response");
  }
  const serverAddress = boundedString(raw.serverAddress, 256);
  if (!serverAddress) throw toUiError("IPC_INVALID_RESPONSE", "errors.ipc.invalid_response");
  const dto: LauncherStatusDto = {
    readiness: readiness as LauncherReadiness,
    serverAddress
  };
  const packVersion = boundedString(raw.packVersion, 64);
  const installedVersion = boundedString(raw.installedVersion, 64) ?? packVersion;
  const latestVersion = boundedString(raw.latestVersion, 64);
  const minecraftVersion = boundedString(raw.minecraftVersion, 64);
  const fabricVersion = boundedString(raw.fabricVersion, 64);
  const channel = boundedString(raw.channel, 32);
  const messageKey = boundedString(raw.messageKey, 128);
  if (packVersion) (dto as { packVersion?: string }).packVersion = packVersion;
  if (installedVersion) (dto as { installedVersion?: string }).installedVersion = installedVersion;
  if (latestVersion) (dto as { latestVersion?: string }).latestVersion = latestVersion;
  if (minecraftVersion) (dto as { minecraftVersion?: string }).minecraftVersion = minecraftVersion;
  if (fabricVersion) (dto as { fabricVersion?: string }).fabricVersion = fabricVersion;
  if (channel) (dto as { channel?: string }).channel = channel;
  if (messageKey) (dto as { messageKey?: string }).messageKey = messageKey;
  if (typeof raw.activeOperation === "string" && ACTIVE_OPS.has(raw.activeOperation)) {
    (dto as { activeOperation?: string }).activeOperation = raw.activeOperation;
  }
  if (typeof raw.recoverability === "string" && RECOVERABILITY.has(raw.recoverability)) {
    (dto as { recoverability?: string }).recoverability = raw.recoverability;
  }
  const progress = normalizeProgressField(raw.progress);
  if (progress) (dto as { progress?: typeof progress }).progress = progress;
  return dto;
}

export function normalizeAccountList(raw: unknown): AccountSummaryDto[] {
  if (!Array.isArray(raw)) throw toUiError("IPC_INVALID_RESPONSE", "errors.ipc.invalid_response");
  if (raw.length > 64) throw toUiError("IPC_INVALID_RESPONSE", "errors.ipc.invalid_response");
  return raw.map((item) => {
    if (!isPlainObject(item)) throw toUiError("IPC_INVALID_RESPONSE", "errors.ipc.invalid_response");
    const accountId = boundedString(item.accountId, 128);
    const minecraftUsername = boundedString(item.minecraftUsername, 64);
    if (!accountId || !minecraftUsername) {
      throw toUiError("IPC_INVALID_RESPONSE", "errors.ipc.invalid_response");
    }
    const dto: AccountSummaryDto = { accountId, minecraftUsername };
    const uuid = boundedString(item.minecraftUuid, 64);
    if (uuid) (dto as { minecraftUuid?: string }).minecraftUuid = uuid;
    if (typeof item.lastUsedAtMs === "number" && Number.isFinite(item.lastUsedAtMs)) {
      (dto as { lastUsedAtMs?: number }).lastUsedAtMs = item.lastUsedAtMs;
    }
    if (typeof item.state === "string" && AUTH.has(item.state as AuthState)) {
      (dto as { state?: AuthState }).state = item.state as AuthState;
    }
    return dto;
  });
}

export function normalizeSettings(raw: unknown): SettingsDto {
  if (!isPlainObject(raw)) throw toUiError("IPC_INVALID_RESPONSE", "errors.ipc.invalid_response");
  if (raw.language !== "fr") throw toUiError("IPC_INVALID_RESPONSE", "errors.ipc.invalid_response");
  if (typeof raw.reducedMotion !== "boolean") {
    throw toUiError("IPC_INVALID_RESPONSE", "errors.ipc.invalid_response");
  }
  const dto: SettingsDto = { language: "fr", reducedMotion: raw.reducedMotion };
  if (raw.memoryMiB !== undefined) {
    if (
      typeof raw.memoryMiB !== "number" ||
      !Number.isInteger(raw.memoryMiB) ||
      raw.memoryMiB < 512 ||
      raw.memoryMiB > 32768
    ) {
      throw toUiError("IPC_INVALID_RESPONSE", "errors.ipc.invalid_response");
    }
    (dto as { memoryMiB?: number }).memoryMiB = raw.memoryMiB;
  }
  return dto;
}

export function unwrapIpcResult<T>(raw: unknown): T {
  if (!isIpcResult(raw)) {
    throw toUiError("IPC_INVALID_RESPONSE", "errors.ipc.invalid_response");
  }
  if (!raw.ok) {
    throw raw.error;
  }
  return raw.value as T;
}

export function assertIpcResultRoundTrip<T>(result: IpcResult<T>): IpcResult<T> {
  const json = JSON.parse(JSON.stringify(result)) as unknown;
  if (!isIpcResult(json)) {
    throw toUiError("IPC_INVALID_RESPONSE", "errors.ipc.invalid_response");
  }
  return json as IpcResult<T>;
}

const NOTIFICATION_LEVELS = new Set(["INFO", "SUCCESS", "WARNING", "ERROR"]);

/**
 * Normalize desktop event payloads before Main → renderer delivery.
 * Required for future progress events (0.6C/0.6D); no generic event bus.
 */
export function normalizeNotificationEvent(raw: unknown): {
  level: "INFO" | "SUCCESS" | "WARNING" | "ERROR";
  messageKey: string;
} {
  if (!isPlainObject(raw)) throw toUiError("IPC_INVALID_RESPONSE", "errors.ipc.invalid_response");
  const level = raw.level;
  const messageKey = boundedString(raw.messageKey, 128);
  if (typeof level !== "string" || !NOTIFICATION_LEVELS.has(level) || !messageKey) {
    throw toUiError("IPC_INVALID_RESPONSE", "errors.ipc.invalid_response");
  }
  return {
    level: level as "INFO" | "SUCCESS" | "WARNING" | "ERROR",
    messageKey
  };
}

export function normalizeEventPayload(
  event: "launcherStatusChanged" | "notification" | "authStateChanged" | "authProgress",
  raw: unknown
): unknown {
  if (event === "launcherStatusChanged") return normalizeLauncherStatus(raw);
  if (event === "notification") return normalizeNotificationEvent(raw);
  // Auth event normalizers live in main/auth; shared validate keeps notification/status.
  return normalizeNotificationEvent(raw);
}
