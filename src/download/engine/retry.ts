import { ErrorCode, LauncherError } from "../../core/errors/index.js";

/** HTTP statuses eligible for automatic download retries. */
export const RETRYABLE_HTTP_STATUSES: ReadonlySet<number> = new Set([
  408, // Request Timeout
  429, // Too Many Requests
  500,
  502,
  503,
  504
]);

/** Deterministic HTTP statuses that must never be retried automatically. */
export const NON_RETRYABLE_HTTP_STATUSES: ReadonlySet<number> = new Set([
  400, 401, 403, 404, 405, 410
]);

/**
 * Explicit retry policy for DownloadEngine.
 * Retry only truly transient failures — never integrity, abort, or deterministic HTTP errors.
 */
export function isRetryableDownloadError(err: LauncherError): boolean {
  if (err.code === ErrorCode.NETWORK_ERROR) return true;
  if (err.code === ErrorCode.HTTP_TIMEOUT) return true;
  if (err.code === ErrorCode.DOWNLOAD_ABORTED) return false;
  if (err.code === ErrorCode.DOWNLOAD_HASH_MISMATCH) return false;
  if (err.code === ErrorCode.DOWNLOAD_SIZE_MISMATCH) return false;
  if (err.code === ErrorCode.UNSAFE_REDIRECT) return false;
  if (err.code === ErrorCode.TOO_MANY_REDIRECTS) return false;
  if (err.code === ErrorCode.METADATA_TOO_LARGE) return false;
  if (err.code === ErrorCode.HTTP_ERROR) {
    const status = err.details.status;
    if (typeof status !== "number" || !Number.isInteger(status)) {
      return false;
    }
    if (NON_RETRYABLE_HTTP_STATUSES.has(status)) return false;
    return RETRYABLE_HTTP_STATUSES.has(status);
  }
  return false;
}
