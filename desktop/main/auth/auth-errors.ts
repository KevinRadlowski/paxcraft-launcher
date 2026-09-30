import { toUiError } from "../../shared/validate.js";
import type { AuthState, UiError } from "../../shared/contract.js";

/** Map frozen / desktop auth codes → safe UiError (no raw messages). */
export function mapAuthCodeToUiError(code: string): UiError {
  switch (code) {
    case "AUTH_LOGIN_REQUIRED":
      return toUiError(code, "error.auth_login_required");
    case "AUTH_REAUTH_REQUIRED":
      return toUiError(code, "error.auth_reauth_required");
    case "AUTH_ACCOUNT_REQUIRED":
    case "AUTH_ACCOUNT_NOT_FOUND":
      return toUiError(code, "error.auth_account_required");
    case "AUTH_ACCOUNT_MISMATCH":
      return toUiError(code, "error.auth_account_mismatch");
    case "AUTH_OPERATION_BUSY":
      return toUiError(code, "error.auth_operation_busy");
    case "AUTH_REQUEST_ABORTED":
      return toUiError(code, "error.auth_aborted");
    case "AUTH_HTTP_TIMEOUT":
    case "AUTH_HTTP_ERROR":
    case "NETWORK_ERROR":
    case "HTTP_TIMEOUT":
      return toUiError(code, "error.network");
    case "AUTH_SESSION_ERROR":
    case "AUTH_STORE_ERROR":
    case "AUTH_SECURE_STORAGE_UNAVAILABLE":
      return toUiError(code, "error.auth_error");
    case "MINECRAFT_APP_NOT_AUTHORIZED":
      return toUiError(code, "error.minecraft_app_not_authorized");
    case "MINECRAFT_NOT_OWNED":
      return toUiError(code, "error.minecraft_not_owned");
    case "MINECRAFT_ACCOUNT_SUSPENDED":
      return toUiError(code, "error.minecraft_account_suspended");
    case "INVALID_MINECRAFT_AUTH":
      return toUiError(code, "error.auth_error");
    case "LIVE_AUTH_NOT_ENABLED":
      return toUiError(code, "error.auth_live_disabled");
    case "MICROSOFT_CLIENT_ID_MISSING":
      return toUiError(code, "error.auth_error");
    default:
      return toUiError(code.slice(0, 128) || "AUTH_SESSION_ERROR", "error.auth_error");
  }
}

export function authStateForErrorCode(code: string): AuthState {
  switch (code) {
    case "AUTH_LOGIN_REQUIRED":
      return "SIGNED_OUT";
    case "AUTH_REAUTH_REQUIRED":
      return "REAUTH_REQUIRED";
    case "AUTH_ACCOUNT_REQUIRED":
    case "AUTH_ACCOUNT_NOT_FOUND":
      return "SIGNED_OUT";
    case "MINECRAFT_APP_NOT_AUTHORIZED":
    case "MINECRAFT_NOT_OWNED":
    case "MINECRAFT_ACCOUNT_SUSPENDED":
    case "AUTH_ACCOUNT_MISMATCH":
    case "AUTH_HTTP_TIMEOUT":
    case "AUTH_HTTP_ERROR":
    case "NETWORK_ERROR":
    case "AUTH_SESSION_ERROR":
      return "ERROR";
    default:
      return "ERROR";
  }
}

export function extractErrorCode(e: unknown): string {
  if (typeof e === "object" && e !== null && "code" in e) {
    const c = (e as { code: unknown }).code;
    if (typeof c === "string" && c.length > 0) return c;
  }
  return "AUTH_SESSION_ERROR";
}
