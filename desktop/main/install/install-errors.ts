import { toUiError } from "../../shared/validate.js";
import type { UiError } from "../../shared/contract.js";

/** Known frozen ErrorCode / desktop codes → safe UI mapping. */
const CODE_MAP: Record<string, { code: string; messageKey: string; retryable: boolean }> = {
  INSTANCE_BUSY: { code: "INSTANCE_BUSY", messageKey: "error.install.busy", retryable: true },
  INSTANCE_LOCKED: { code: "INSTANCE_BUSY", messageKey: "error.install.busy", retryable: true },
  GAME_ALREADY_RUNNING: {
    code: "INSTANCE_BUSY",
    messageKey: "error.install.busy",
    retryable: true
  },
  GAME_PROCESS_LOCKED: {
    code: "INSTANCE_BUSY",
    messageKey: "error.install.busy",
    retryable: true
  },
  NETWORK_ERROR: {
    code: "NETWORK_ERROR",
    messageKey: "error.install.network",
    retryable: true
  },
  HTTP_ERROR: { code: "NETWORK_ERROR", messageKey: "error.install.network", retryable: true },
  HTTP_TIMEOUT: { code: "NETWORK_ERROR", messageKey: "error.install.network", retryable: true },
  DOWNLOAD_FAILED: {
    code: "NETWORK_ERROR",
    messageKey: "error.install.network",
    retryable: true
  },
  DOWNLOAD_HASH_MISMATCH: {
    code: "INTEGRITY_ERROR",
    messageKey: "error.install.integrity",
    retryable: false
  },
  DOWNLOAD_SIZE_MISMATCH: {
    code: "INTEGRITY_ERROR",
    messageKey: "error.install.integrity",
    retryable: false
  },
  RELEASE_HASH_MISMATCH: {
    code: "INTEGRITY_ERROR",
    messageKey: "error.install.integrity",
    retryable: false
  },
  MANIFEST_HASH_MISMATCH: {
    code: "INTEGRITY_ERROR",
    messageKey: "error.install.integrity",
    retryable: false
  },
  OPERATION_VERIFY_FAILED: {
    code: "INTEGRITY_ERROR",
    messageKey: "error.install.integrity",
    retryable: false
  },
  UNKNOWN_SIGNING_KEY: {
    code: "TRUST_ERROR",
    messageKey: "error.install.trust",
    retryable: false
  },
  INVALID_CHANNEL_SIGNATURE: {
    code: "TRUST_ERROR",
    messageKey: "error.install.trust",
    retryable: false
  },
  INVALID_RELEASE_SIGNATURE: {
    code: "TRUST_ERROR",
    messageKey: "error.install.trust",
    retryable: false
  },
  UNSIGNED_REFUSED: {
    code: "TRUST_ERROR",
    messageKey: "error.install.trust",
    retryable: false
  },
  ROLLBACK_DETECTED: {
    code: "TRUST_ERROR",
    messageKey: "error.install.trust",
    retryable: false
  },
  FILE_LOCKED: {
    code: "FILESYSTEM_ERROR",
    messageKey: "error.install.filesystem",
    retryable: true
  },
  SYMLINK_ESCAPE: {
    code: "FILESYSTEM_ERROR",
    messageKey: "error.install.filesystem",
    retryable: false
  },
  INSTANCE_RECOVERY_REQUIRED: {
    code: "RECOVERY_REQUIRED",
    messageKey: "error.install.recovery",
    retryable: false
  },
  TRANSACTION_INVALID: {
    code: "RECOVERY_REQUIRED",
    messageKey: "error.install.recovery",
    retryable: false
  },
  CORRUPT_STATE: {
    code: "STATE_CORRUPT",
    messageKey: "error.install.state_corrupt",
    retryable: false
  },
  INSTANCE_STATE_INVALID: {
    code: "STATE_CORRUPT",
    messageKey: "error.install.state_corrupt",
    retryable: false
  },
  INSTANCE_NOT_INSTALLED: {
    code: "INSTANCE_NOT_INSTALLED",
    messageKey: "error.install.not_installed",
    retryable: false
  },
  INSTANCE_ALREADY_INSTALLED: {
    code: "INSTANCE_ALREADY_INSTALLED",
    messageKey: "error.install.already_installed",
    retryable: false
  },
  FAKE_INSTALL_NETWORK: {
    code: "NETWORK_ERROR",
    messageKey: "error.install.network",
    retryable: true
  },
  FAKE_INSTALL_INTEGRITY: {
    code: "INTEGRITY_ERROR",
    messageKey: "error.install.integrity",
    retryable: false
  },
  FAKE_INSTALL_GENERIC: {
    code: "INTERNAL_ERROR",
    messageKey: "error.install.generic",
    retryable: true
  },
  UNINSTALL_FAILED: {
    code: "UNINSTALL_FAILED",
    messageKey: "error.install.uninstall_failed",
    retryable: false
  },
  INSTANCE_LOCATION_INVALID: {
    code: "INSTANCE_LOCATION_INVALID",
    messageKey: "error.instance.location.invalid",
    retryable: false
  },
  INSTANCE_LOCATION_NOT_EMPTY: {
    code: "INSTANCE_LOCATION_NOT_EMPTY",
    messageKey: "error.instance.location.not_empty",
    retryable: false
  },
  INSTANCE_OWNERSHIP_NOT_PROVEN: {
    code: "INSTANCE_OWNERSHIP_NOT_PROVEN",
    messageKey: "error.instance.location.ownership_not_proven",
    retryable: false
  },
  INSTANCE_LOCATION_UNAVAILABLE: {
    code: "INSTANCE_LOCATION_UNAVAILABLE",
    messageKey: "install.message.location_unavailable",
    retryable: false
  },
  INSTANCE_MOVE_FAILED: {
    code: "INSTANCE_MOVE_FAILED",
    messageKey: "error.instance.location.move_failed",
    retryable: false
  },
  INSUFFICIENT_DISK_SPACE: {
    code: "INSUFFICIENT_DISK_SPACE",
    messageKey: "error.instance.location.insufficient_space",
    retryable: false
  }
};

export function extractInstallErrorCode(e: unknown): string | null {
  if (typeof e !== "object" || e === null) return null;
  const o = e as Record<string, unknown>;
  if (typeof o.code === "string" && o.code.length > 0 && o.code.length <= 128) {
    return o.code;
  }
  return null;
}

export function mapInstallError(e: unknown): UiError {
  if (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    "messageKey" in e &&
    typeof (e as UiError).code === "string" &&
    typeof (e as UiError).messageKey === "string"
  ) {
    const u = e as UiError;
    // Already normalized desktop UiError — strip any leaky details.
    return toUiError(u.code.slice(0, 128), u.messageKey.slice(0, 128));
  }
  const raw = extractInstallErrorCode(e);
  if (raw && CODE_MAP[raw]) {
    const m = CODE_MAP[raw]!;
    return toUiError(m.code, m.messageKey);
  }
  return toUiError("INTERNAL_ERROR", "error.install.generic");
}

export function isInstallErrorRetryable(code: string): boolean {
  const entry = Object.values(CODE_MAP).find((m) => m.code === code);
  if (entry) return entry.retryable;
  const byRaw = CODE_MAP[code];
  return byRaw?.retryable ?? false;
}
