import { ErrorCode, LauncherError } from "../../core/errors/index.js";

/**
 * Allowlisted internal Minecraft Services failure reasons.
 * Never copy remote errorMessage / path / arbitrary details into diagnostics.
 */
export type MinecraftServiceReason =
  | "INVALID_APP_REGISTRATION"
  | "ACCOUNT_SUSPENDED"
  | "UNKNOWN";

export interface MinecraftServiceErrorClassification {
  minecraftReason: MinecraftServiceReason;
  /** Prefer this ErrorCode when throwing from login_with_xbox. */
  errorCode:
    | typeof ErrorCode.MINECRAFT_APP_NOT_AUTHORIZED
    | typeof ErrorCode.MINECRAFT_ACCOUNT_SUSPENDED
    | typeof ErrorCode.INVALID_MINECRAFT_AUTH;
}

/**
 * Classify Minecraft Services error JSON without propagating hostile strings.
 * Recognizes known shapes only; everything else → UNKNOWN.
 *
 * ensureLegacyEnabled: NOT used here and NOT added to login_with_xbox as a blind
 * workaround — it does not fix INVALID_APP_REGISTRATION (clientId / app restriction).
 */
export function classifyMinecraftServiceError(body: string): MinecraftServiceErrorClassification {
  let raw: unknown;
  try {
    raw = JSON.parse(body) as unknown;
  } catch {
    return {
      minecraftReason: "UNKNOWN",
      errorCode: ErrorCode.INVALID_MINECRAFT_AUTH
    };
  }
  if (!isObj(raw)) {
    return {
      minecraftReason: "UNKNOWN",
      errorCode: ErrorCode.INVALID_MINECRAFT_AUTH
    };
  }

  const details = isObj(raw.details) ? raw.details : undefined;
  const detailsReason =
    typeof details?.reason === "string" ? details.reason.trim().toUpperCase() : "";

  if (detailsReason === "ACCOUNT_SUSPENDED") {
    return {
      minecraftReason: "ACCOUNT_SUSPENDED",
      errorCode: ErrorCode.MINECRAFT_ACCOUNT_SUSPENDED
    };
  }

  // Known app-registration refusal — match on controlled substrings of known fields only
  // (in-memory classification). Result is allowlisted enum, never the remote string.
  if (looksLikeInvalidAppRegistration(raw)) {
    return {
      minecraftReason: "INVALID_APP_REGISTRATION",
      errorCode: ErrorCode.MINECRAFT_APP_NOT_AUTHORIZED
    };
  }

  return {
    minecraftReason: "UNKNOWN",
    errorCode: ErrorCode.INVALID_MINECRAFT_AUTH
  };
}

function looksLikeInvalidAppRegistration(raw: Record<string, unknown>): boolean {
  const candidates: string[] = [];
  for (const key of ["errorMessage", "error", "errorType"] as const) {
    if (typeof raw[key] === "string") candidates.push(raw[key] as string);
  }
  const details = isObj(raw.details) ? raw.details : undefined;
  if (typeof details?.reason === "string") candidates.push(details.reason);

  for (const s of candidates) {
    const lower = s.toLowerCase();
    if (lower.includes("invalid app registration")) return true;
  }
  return false;
}

/** Build LauncherError for login_with_xbox non-2xx — status + minecraftReason only. */
export function minecraftLoginHttpError(status: number, body: string): LauncherError {
  const { minecraftReason, errorCode } = classifyMinecraftServiceError(body);
  const message =
    errorCode === ErrorCode.MINECRAFT_APP_NOT_AUTHORIZED
      ? "Minecraft Services refused this app registration"
      : errorCode === ErrorCode.MINECRAFT_ACCOUNT_SUSPENDED
        ? "Minecraft account suspended"
        : `Minecraft login HTTP ${status}`;
  return new LauncherError(errorCode, message, {
    status,
    minecraftReason
  });
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
