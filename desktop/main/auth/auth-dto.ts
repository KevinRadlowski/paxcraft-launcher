import type {
  AuthActionResultDto,
  AuthProgressDto,
  AuthProgressPhase,
  AuthState,
  AuthStateDto,
  SafeAccountDto,
  UiError
} from "../../shared/contract.js";
import { toUiError } from "../../shared/validate.js";

const AUTH_STATES = new Set<AuthState>([
  "UNKNOWN",
  "SIGNED_OUT",
  "RESTORING",
  "AUTHENTICATED",
  "REAUTH_REQUIRED",
  "ERROR"
]);

const PROGRESS_PHASES = new Set<AuthProgressPhase>([
  "STARTING",
  "OPENING_BROWSER",
  "WAITING_FOR_CALLBACK",
  "MICROSOFT_AUTHENTICATED",
  "XBOX_AUTHENTICATING",
  "MINECRAFT_AUTHENTICATING",
  "CHECKING_ENTITLEMENT",
  "LOADING_PROFILE",
  "RESTORING",
  "AUTHENTICATED",
  "FAILED",
  "CANCELLED"
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

/** Account ids are `mc:` + uuid or opaque bounded ids from registry. */
export function assertAccountIdPayload(raw: unknown): string {
  if (!isPlainObject(raw)) {
    throw toUiError("IPC_INVALID_PAYLOAD", "errors.ipc.invalid_payload");
  }
  // Reject OAuth endpoint / clientId / scopes smuggling
  for (const forbidden of [
    "clientId",
    "scopes",
    "authorizationUrl",
    "redirectUri",
    "authority",
    "accessToken",
    "refreshToken"
  ]) {
    if (forbidden in raw) {
      throw toUiError("IPC_INVALID_PAYLOAD", "errors.ipc.invalid_payload");
    }
  }
  const id = boundedString(raw.accountId, 128);
  if (!id) throw toUiError("IPC_INVALID_PAYLOAD", "errors.ipc.invalid_payload");
  if (!/^mc:[a-f0-9-]{32,40}$/i.test(id) && !/^[a-zA-Z0-9:_-]{3,128}$/.test(id)) {
    throw toUiError("IPC_INVALID_PAYLOAD", "errors.ipc.invalid_payload");
  }
  return id;
}

export function assertOptionalAccountIdPayload(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (isPlainObject(raw) && Object.keys(raw).length === 0) return undefined;
  if (!isPlainObject(raw)) {
    throw toUiError("IPC_INVALID_PAYLOAD", "errors.ipc.invalid_payload");
  }
  if (!("accountId" in raw) || raw.accountId === undefined || raw.accountId === null) {
    // allow empty restore
    for (const forbidden of ["clientId", "scopes", "authorizationUrl", "redirectUri"]) {
      if (forbidden in raw) {
        throw toUiError("IPC_INVALID_PAYLOAD", "errors.ipc.invalid_payload");
      }
    }
    if (Object.keys(raw).length === 0) return undefined;
    throw toUiError("IPC_INVALID_PAYLOAD", "errors.ipc.invalid_payload");
  }
  return assertAccountIdPayload(raw);
}

export function assertLoginPayload(raw: unknown): void {
  if (raw === undefined || raw === null) return;
  if (isPlainObject(raw) && Object.keys(raw).length === 0) return;
  // Renderer must never supply OAuth parameters.
  throw toUiError("IPC_INVALID_PAYLOAD", "errors.ipc.invalid_payload");
}

export function normalizeSafeAccount(raw: unknown): SafeAccountDto {
  if (!isPlainObject(raw)) throw toUiError("IPC_INVALID_RESPONSE", "errors.ipc.invalid_response");
  const accountId = boundedString(raw.accountId, 128);
  const minecraftUsername = boundedString(raw.minecraftUsername, 64);
  if (!accountId || !minecraftUsername) {
    throw toUiError("IPC_INVALID_RESPONSE", "errors.ipc.invalid_response");
  }
  const dto: SafeAccountDto = { accountId, minecraftUsername };
  const uuid = boundedString(raw.minecraftUuid, 64);
  if (uuid) (dto as { minecraftUuid?: string }).minecraftUuid = uuid;
  if (typeof raw.lastUsedAtMs === "number" && Number.isFinite(raw.lastUsedAtMs)) {
    (dto as { lastUsedAtMs?: number }).lastUsedAtMs = raw.lastUsedAtMs;
  }
  return dto;
}

export function normalizeSafeAccountList(raw: unknown): SafeAccountDto[] {
  if (!Array.isArray(raw)) throw toUiError("IPC_INVALID_RESPONSE", "errors.ipc.invalid_response");
  if (raw.length > 64) throw toUiError("IPC_INVALID_RESPONSE", "errors.ipc.invalid_response");
  return raw.map(normalizeSafeAccount);
}

function normalizeUiErrorShape(raw: unknown): UiError | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isPlainObject(raw)) throw toUiError("IPC_INVALID_RESPONSE", "errors.ipc.invalid_response");
  const code = boundedString(raw.code, 128);
  const messageKey = boundedString(raw.messageKey, 128);
  if (!code || !messageKey) {
    throw toUiError("IPC_INVALID_RESPONSE", "errors.ipc.invalid_response");
  }
  return { code, messageKey };
}

export function normalizeAuthStateDto(raw: unknown): AuthStateDto {
  if (!isPlainObject(raw)) throw toUiError("IPC_INVALID_RESPONSE", "errors.ipc.invalid_response");
  const state = raw.state;
  if (typeof state !== "string" || !AUTH_STATES.has(state as AuthState)) {
    throw toUiError("IPC_INVALID_RESPONSE", "errors.ipc.invalid_response");
  }
  const dto: AuthStateDto = { state: state as AuthState };
  const selected = boundedString(raw.selectedAccountId, 128);
  if (selected) (dto as { selectedAccountId?: string }).selectedAccountId = selected;
  if (raw.account !== undefined && raw.account !== null) {
    (dto as { account?: SafeAccountDto }).account = normalizeSafeAccount(raw.account);
  }
  const err = normalizeUiErrorShape(raw.error);
  if (err) (dto as { error?: UiError }).error = err;
  return dto;
}

export function normalizeAuthProgressDto(raw: unknown): AuthProgressDto {
  if (!isPlainObject(raw)) throw toUiError("IPC_INVALID_RESPONSE", "errors.ipc.invalid_response");
  const phase = raw.phase;
  if (typeof phase !== "string" || !PROGRESS_PHASES.has(phase as AuthProgressPhase)) {
    throw toUiError("IPC_INVALID_RESPONSE", "errors.ipc.invalid_response");
  }
  const dto: AuthProgressDto = { phase: phase as AuthProgressPhase };
  const messageKey = boundedString(raw.messageKey, 128);
  if (messageKey) (dto as { messageKey?: string }).messageKey = messageKey;
  return dto;
}

export function normalizeAuthActionResult(raw: unknown): AuthActionResultDto {
  if (!isPlainObject(raw)) throw toUiError("IPC_INVALID_RESPONSE", "errors.ipc.invalid_response");
  return {
    state: normalizeAuthStateDto(raw.state),
    accounts: normalizeSafeAccountList(raw.accounts)
  };
}

/** Drop malformed events rather than forwarding arbitrary objects. */
export function tryNormalizeAuthStateEvent(raw: unknown): AuthStateDto | null {
  try {
    return normalizeAuthStateDto(raw);
  } catch {
    return null;
  }
}

export function tryNormalizeAuthProgressEvent(raw: unknown): AuthProgressDto | null {
  try {
    return normalizeAuthProgressDto(raw);
  } catch {
    return null;
  }
}
