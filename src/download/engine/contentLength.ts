/**
 * Parse Content-Length for download pre-checks.
 * Only finite, non-negative safe integers are accepted.
 * Invalid values return null (ignored) — streamed byte count remains authoritative.
 * Invalid values must never bypass maxBytes (engine still enforces on stream).
 */
export function parseContentLengthHeader(value: string | null): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;
  // Reject values that exceed Number.MAX_SAFE_INTEGER when parsed.
  if (trimmed.length > 15) {
    // Still parse carefully
    try {
      const asBig = BigInt(trimmed);
      if (asBig < 0n || asBig > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      return Number(asBig);
    } catch {
      return null;
    }
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) {
    return null;
  }
  return n;
}
