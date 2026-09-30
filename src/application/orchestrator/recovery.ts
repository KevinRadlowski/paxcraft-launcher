import type { InstancePaths } from "../../instance/layout/index.js";
import {
  cleanupSafeOrphanTransactions,
  listOrphanTransactions,
  scanTransactions,
  type TransactionMetadata
} from "./transaction.js";

export type RecoveryAction = "CLEANED" | "AUDIT_REQUIRED" | "NONE";

export interface RecoveryReport {
  cleanedTransactionIds: string[];
  remaining: TransactionMetadata[];
  action: RecoveryAction;
  /** Present when corrupt transaction dirs remain (never auto-deleted). */
  corruptCount: number;
}

/**
 * Crash recovery without fragile rollback:
 * - PLANNED / ACQUIRING / FAILED / ABANDONED → safe cleanup (caller should hold exclusive lock)
 * - APPLYING / VERIFYING / COMMITTING → leave in place (AUDIT_REQUIRED)
 * - Corrupt metadata → leave in place (AUDIT_REQUIRED); never auto-delete
 *
 * metadata.json is recovery SoT; journal.json is diagnostic-only.
 *
 * AUDIT_REQUIRED / status RECOVERY_REQUIRED blocks all mutating operations
 * until explicit reconciliation. No silent cleanup of risky/corrupt phases.
 */
export async function reconcileOrphanTransactions(paths: InstancePaths): Promise<RecoveryReport> {
  const cleanedTransactionIds = await cleanupSafeOrphanTransactions(paths);
  const scan = await scanTransactions(paths);
  const remaining = scan.orphans;
  const corruptCount = scan.corrupt.length;
  let action: RecoveryAction = "NONE";
  if (remaining.length > 0 || corruptCount > 0) action = "AUDIT_REQUIRED";
  else if (cleanedTransactionIds.length > 0) action = "CLEANED";
  return { cleanedTransactionIds, remaining, action, corruptCount };
}

export { listOrphanTransactions };
