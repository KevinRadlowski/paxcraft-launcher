import { ErrorCode, LauncherError } from "../core/errors/index.js";
import type { Clock } from "./clock.js";

/**
 * Compute expiresAtMs = now + expiresInSec * 1000 with overflow / safe-integer checks.
 */
export function computeExpiresAtMs(clock: Clock, expiresInSec: number): number {
  if (
    typeof expiresInSec !== "number" ||
    !Number.isFinite(expiresInSec) ||
    !Number.isInteger(expiresInSec) ||
    expiresInSec <= 0 ||
    !Number.isSafeInteger(expiresInSec)
  ) {
    throw new LauncherError(ErrorCode.INVALID_TOKEN_EXPIRY, "invalid expires_in", {});
  }
  const now = clock.nowMs();
  if (!Number.isSafeInteger(now)) {
    throw new LauncherError(ErrorCode.INVALID_TOKEN_EXPIRY, "clock nowMs not safe integer", {});
  }
  // Check expiresInSec * 1000 won't overflow safe integer
  if (expiresInSec > Math.floor(Number.MAX_SAFE_INTEGER / 1000)) {
    throw new LauncherError(ErrorCode.INVALID_TOKEN_EXPIRY, "expires_in too large", {});
  }
  const delta = expiresInSec * 1000;
  const expiresAtMs = now + delta;
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs < now) {
    throw new LauncherError(ErrorCode.INVALID_TOKEN_EXPIRY, "expiresAtMs overflow", {});
  }
  return expiresAtMs;
}
