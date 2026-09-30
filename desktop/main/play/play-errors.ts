import { toUiError } from "../../shared/validate.js";
import type { UiError } from "../../shared/contract.js";

const CODE_MAP: Record<string, { code: string; messageKey: string }> = {
  PLAY_INSTALL_REQUIRED: {
    code: "PLAY_INSTALL_REQUIRED",
    messageKey: "error.play_install_required"
  },
  PLAY_UPDATE_REQUIRED: {
    code: "PLAY_UPDATE_REQUIRED",
    messageKey: "error.play_update_required"
  },
  PLAY_REPAIR_REQUIRED: {
    code: "PLAY_REPAIR_REQUIRED",
    messageKey: "error.play_repair_required"
  },
  INSTANCE_BUSY: { code: "INSTANCE_BUSY", messageKey: "error.install.busy" },
  INSTANCE_RECOVERY_REQUIRED: {
    code: "RECOVERY_REQUIRED",
    messageKey: "error.install.recovery"
  },
  INSTANCE_STATE_INVALID: {
    code: "STATE_CORRUPT",
    messageKey: "error.install.state_corrupt"
  },
  GAME_ALREADY_RUNNING: {
    code: "GAME_ALREADY_RUNNING",
    messageKey: "error.play.already_running"
  },
  GAME_PROCESS_LOCKED: {
    code: "GAME_ALREADY_RUNNING",
    messageKey: "error.play.already_running"
  },
  GAME_PROCESS_LOCK_INVALID: {
    code: "MALFORMED_LOCK",
    messageKey: "error.play.malformed_lock"
  },
  AUTH_ACCOUNT_MISMATCH: {
    code: "AUTH_ACCOUNT_MISMATCH",
    messageKey: "error.play.account_mismatch"
  },
  AUTH_ACCOUNT_REQUIRED: {
    code: "AUTH_ACCOUNT_REQUIRED",
    messageKey: "error.auth_account_required"
  },
  AUTH_ACCOUNT_NOT_FOUND: {
    code: "AUTH_ACCOUNT_NOT_FOUND",
    messageKey: "error.auth_account_required"
  },
  AUTH_LOGIN_REQUIRED: {
    code: "AUTH_LOGIN_REQUIRED",
    messageKey: "error.auth_login_required"
  },
  AUTH_REAUTH_REQUIRED: {
    code: "AUTH_REAUTH_REQUIRED",
    messageKey: "error.auth_reauth_required"
  },
  INVALID_OAUTH_CONFIG: {
    code: "AUTH_UNAVAILABLE",
    messageKey: "error.auth_login_required"
  },
  MICROSOFT_CLIENT_ID_MISSING: {
    code: "AUTH_UNAVAILABLE",
    messageKey: "error.auth_login_required"
  },
  LIVE_AUTH_NOT_ENABLED: {
    code: "AUTH_UNAVAILABLE",
    messageKey: "error.auth_login_required"
  },
  MISSING_JAVA: { code: "JAVA_UNAVAILABLE", messageKey: "error.play.java_unavailable" },
  INCOMPATIBLE_JAVA: {
    code: "JAVA_UNAVAILABLE",
    messageKey: "error.play.java_unavailable"
  },
  INVALID_JAVA_VERSION: {
    code: "JAVA_UNAVAILABLE",
    messageKey: "error.play.java_unavailable"
  },
  JAVA_PROVIDER_UNAVAILABLE: {
    code: "JAVA_UNAVAILABLE",
    messageKey: "error.play.java_provision_failed"
  },
  JAVA_PROVIDER_ARTIFACT_MISSING: {
    code: "JAVA_UNAVAILABLE",
    messageKey: "error.play.java_provision_failed"
  },
  JAVA_PROVIDER_METADATA_INVALID: {
    code: "JAVA_UNAVAILABLE",
    messageKey: "error.play.java_provision_failed"
  },
  JAVA_DOWNLOAD_FAILED: {
    code: "JAVA_UNAVAILABLE",
    messageKey: "error.play.java_download_failed"
  },
  JAVA_HASH_MISMATCH: {
    code: "JAVA_UNAVAILABLE",
    messageKey: "error.play.java_verify_failed"
  },
  JAVA_ARCHIVE_UNSAFE: {
    code: "JAVA_UNAVAILABLE",
    messageKey: "error.play.java_verify_failed"
  },
  JAVA_EXTRACTION_FAILED: {
    code: "JAVA_UNAVAILABLE",
    messageKey: "error.play.java_install_failed"
  },
  JAVA_EXECUTABLE_MISSING: {
    code: "JAVA_UNAVAILABLE",
    messageKey: "error.play.java_install_failed"
  },
  JAVA_PROVISIONED_INCOMPATIBLE: {
    code: "JAVA_UNAVAILABLE",
    messageKey: "error.play.java_verify_failed"
  },
  JAVA_PROVISION_BUSY: {
    code: "INSTANCE_BUSY",
    messageKey: "error.play.java_busy"
  },
  JAVA_PROVISION_FS_ERROR: {
    code: "JAVA_UNAVAILABLE",
    messageKey: "error.play.java_install_failed"
  },
  GAME_PROCESS_SPAWN_FAILED: {
    code: "SPAWN_FAILURE",
    messageKey: "error.play.spawn_failure"
  },
  GAME_PROCESS_LOCK_UPDATE_FAILED: {
    code: "BIND_FAILURE",
    messageKey: "error.play.bind_failure"
  },
  LAUNCH_NOT_READY: { code: "LAUNCH_NOT_READY", messageKey: "error.play.launch_failure" },
  FAKE_PLAY_ACCOUNT_MISMATCH: {
    code: "AUTH_ACCOUNT_MISMATCH",
    messageKey: "error.play.account_mismatch"
  },
  FAKE_PLAY_JAVA: { code: "JAVA_UNAVAILABLE", messageKey: "error.play.java_unavailable" },
  FAKE_PLAY_SPAWN: { code: "SPAWN_FAILURE", messageKey: "error.play.spawn_failure" },
  FAKE_PLAY_BIND: { code: "BIND_FAILURE", messageKey: "error.play.bind_failure" },
  FAKE_PLAY_MALFORMED: { code: "MALFORMED_LOCK", messageKey: "error.play.malformed_lock" },
  FAKE_PLAY_GENERIC: { code: "INTERNAL_ERROR", messageKey: "error.play.generic" }
};

export function mapPlayError(e: unknown): UiError {
  if (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    "messageKey" in e &&
    typeof (e as UiError).code === "string" &&
    typeof (e as UiError).messageKey === "string"
  ) {
    const u = e as UiError;
    return toUiError(u.code.slice(0, 128), u.messageKey.slice(0, 128));
  }
  const raw =
    typeof e === "object" && e !== null && typeof (e as { code?: unknown }).code === "string"
      ? String((e as { code: string }).code)
      : null;
  if (raw && CODE_MAP[raw]) {
    const m = CODE_MAP[raw]!;
    return toUiError(m.code, m.messageKey);
  }
  return toUiError("INTERNAL_ERROR", "error.play.generic");
}
