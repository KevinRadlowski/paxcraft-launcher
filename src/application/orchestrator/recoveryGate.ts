import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import type { TransactionPhase } from "./types.js";
import type { TransactionMetadata, TransactionScanResult } from "./transaction.js";

export const RISKY_ORPHAN_PHASES = ["APPLYING", "VERIFYING", "COMMITTING"] as const;

export type RiskyOrphanPhase = (typeof RISKY_ORPHAN_PHASES)[number];

export function isRiskyOrphanPhase(phase: TransactionPhase): phase is RiskyOrphanPhase {
  return (RISKY_ORPHAN_PHASES as readonly string[]).includes(phase);
}

export function filterRiskyOrphans(orphans: TransactionMetadata[]): TransactionMetadata[] {
  return orphans
    .filter((o) => isRiskyOrphanPhase(o.phase))
    .slice()
    .sort((a, b) => a.transactionId.localeCompare(b.transactionId));
}

/**
 * Fail closed on corrupt transaction directories.
 * Safe details only — no metadata bodies / filesystem paths.
 */
export function assertNoCorruptTransactions(scan: TransactionScanResult): void {
  if (scan.corrupt.length === 0) return;

  const reasons = [...new Set(scan.corrupt.map((c) => c.reason))].sort();
  throw new LauncherError(
    ErrorCode.INSTANCE_RECOVERY_REQUIRED,
    "instance has corrupt transaction metadata; reconcile before mutating",
    {
      reason: "CORRUPT_TRANSACTION",
      corruptCount: scan.corrupt.length,
      reasons,
      directoryIds: scan.corrupt.map((c) => c.directoryId)
    }
  );
}

/**
 * Fail closed if any APPLYING/VERIFYING/COMMITTING orphan remains.
 * Safe details only — no filesystem paths / journal bodies.
 */
export function assertNoRiskyOrphanTransactions(orphans: TransactionMetadata[]): void {
  const risky = filterRiskyOrphans(orphans);
  if (risky.length === 0) return;

  const phases = [...new Set(risky.map((r) => r.phase))].sort();
  const details: Record<string, unknown> = {
    riskyCount: risky.length,
    phases,
    transactionIds: risky.map((r) => r.transactionId)
  };

  if (risky.length === 1) {
    const only = risky[0]!;
    details.phase = only.phase;
    details.operation = only.operation;
    details.transactionId = only.transactionId;
    if (only.packVersion !== null) details.packVersion = only.packVersion;
    if (only.releaseSequence !== null) details.releaseSequence = only.releaseSequence;
  }

  throw new LauncherError(
    ErrorCode.INSTANCE_RECOVERY_REQUIRED,
    "instance has unfinished transaction; reconcile before mutating",
    details
  );
}

/** Strict post-cleanup gate for mutating orchestrator flows. */
export function assertNoCorruptOrRiskyTransactions(scan: TransactionScanResult): void {
  assertNoCorruptTransactions(scan);
  assertNoRiskyOrphanTransactions(scan.orphans);
}
