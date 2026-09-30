import { readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import { writeFileAtomic, ensureDir } from "../../download/fs/index.js";
import type { InstancePaths } from "../../instance/layout/index.js";
import type { LauncherOperation, TransactionPhase } from "./types.js";

export interface TransactionMetadata {
  schemaVersion: 1;
  transactionId: string;
  operation: Exclude<LauncherOperation, "status">;
  channel: string;
  packVersion: string | null;
  releaseSequence: number | null;
  createdAt: string;
  updatedAt: string;
  phase: TransactionPhase;
}

export interface TransactionJournal {
  schemaVersion: 1;
  transactionId: string;
  phase: TransactionPhase;
  updatedAt: string;
  /** Allowlisted notes only — never secrets/bodies. */
  notes: string[];
}

/** Safe reason codes for corrupt transaction directories — never raw JSON/paths. */
export type CorruptTransactionReason =
  | "MISSING_METADATA"
  | "UNREADABLE_METADATA"
  | "MALFORMED_JSON"
  | "INVALID_SCHEMA"
  | "INVALID_FIELDS"
  | "INVALID_PHASE"
  | "TRANSACTION_ID_MISMATCH"
  | "NOT_A_DIRECTORY";

export interface CorruptTransactionEntry {
  directoryId: string;
  reason: CorruptTransactionReason;
}

export interface TransactionScanResult {
  /** Parsed non-COMMITTED transactions. */
  orphans: TransactionMetadata[];
  /** Successfully parsed COMMITTED (normally cleaned; rare if leftover). */
  committed: TransactionMetadata[];
  /** Directories that exist but cannot be trusted. */
  corrupt: CorruptTransactionEntry[];
}

const TRANSACTION_PHASES = new Set<TransactionPhase>([
  "PLANNED",
  "ACQUIRING",
  "STAGED",
  "APPLYING",
  "VERIFYING",
  "COMMITTING",
  "COMMITTED",
  "FAILED",
  "ABANDONED"
]);

const SAFE_CLEANUP_PHASES = new Set<TransactionPhase>([
  "PLANNED",
  "ACQUIRING",
  "FAILED",
  "ABANDONED"
]);

export class OrchestratorTransaction {
  readonly transactionId: string;
  readonly dir: string;
  private meta: TransactionMetadata;

  private constructor(transactionId: string, dir: string, meta: TransactionMetadata) {
    this.transactionId = transactionId;
    this.dir = dir;
    this.meta = meta;
  }

  static transactionsRoot(paths: InstancePaths): string {
    return path.join(paths.launcherDir(), "transactions");
  }

  static async create(
    paths: InstancePaths,
    opts: {
      operation: Exclude<LauncherOperation, "status">;
      channel: string;
      packVersion?: string | null;
      releaseSequence?: number | null;
      idFactory?: () => string;
    }
  ): Promise<OrchestratorTransaction> {
    const transactionId = opts.idFactory?.() ?? randomUUID();
    if (!isSafeTransactionDirectoryId(transactionId)) {
      throw new LauncherError(ErrorCode.TRANSACTION_INVALID, "unsafe transaction id");
    }
    const dir = path.join(OrchestratorTransaction.transactionsRoot(paths), transactionId);
    await ensureDir(dir);
    // metadata.json = recovery SoT; journal.json = diagnostic companion only.
    const now = new Date().toISOString();
    const meta: TransactionMetadata = {
      schemaVersion: 1,
      transactionId,
      operation: opts.operation,
      channel: opts.channel,
      packVersion: opts.packVersion ?? null,
      releaseSequence: opts.releaseSequence ?? null,
      createdAt: now,
      updatedAt: now,
      phase: "PLANNED"
    };
    const tx = new OrchestratorTransaction(transactionId, dir, meta);
    await tx.writeMeta();
    await tx.writeJournal("PLANNED", ["created"]);
    return tx;
  }

  async setPhase(phase: TransactionPhase, note?: string): Promise<void> {
    this.meta = {
      ...this.meta,
      phase,
      updatedAt: new Date().toISOString()
    };
    await this.writeMeta();
    await this.writeJournal(phase, note ? [note] : []);
  }

  get phase(): TransactionPhase {
    return this.meta.phase;
  }

  async setReleaseIdentity(packVersion: string, releaseSequence: number): Promise<void> {
    this.meta = {
      ...this.meta,
      packVersion,
      releaseSequence,
      updatedAt: new Date().toISOString()
    };
    await this.writeMeta();
  }

  async cleanup(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
  }

  private async writeMeta(): Promise<void> {
    await writeFileAtomic(
      path.join(this.dir, "metadata.json"),
      JSON.stringify(this.meta, null, 2) + "\n"
    );
  }

  private async writeJournal(phase: TransactionPhase, notes: string[]): Promise<void> {
    const journal: TransactionJournal = {
      schemaVersion: 1,
      transactionId: this.transactionId,
      phase,
      updatedAt: new Date().toISOString(),
      notes
    };
    await writeFileAtomic(
      path.join(this.dir, "journal.json"),
      JSON.stringify(journal, null, 2) + "\n"
    );
  }
}

export function isSafeTransactionDirectoryId(id: string): boolean {
  return typeof id === "string" && /^[a-zA-Z0-9._-]{1,128}$/.test(id) && !id.includes("..");
}

/**
 * Strict TransactionMetadata validator.
 * `directoryId` must equal metadata.transactionId.
 */
export function parseTransactionMetadata(
  raw: unknown,
  directoryId: string
): TransactionMetadata {
  if (!isSafeTransactionDirectoryId(directoryId)) {
    throw new LauncherError(ErrorCode.TRANSACTION_INVALID, "unsafe transaction directory id", {
      reason: "INVALID_FIELDS"
    });
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new LauncherError(ErrorCode.TRANSACTION_INVALID, "transaction metadata not an object", {
      reason: "INVALID_FIELDS"
    });
  }
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== 1) {
    throw new LauncherError(ErrorCode.TRANSACTION_INVALID, "unsupported transaction schema", {
      reason: "INVALID_SCHEMA"
    });
  }
  if (typeof o.transactionId !== "string" || !o.transactionId) {
    throw new LauncherError(ErrorCode.TRANSACTION_INVALID, "transactionId missing", {
      reason: "INVALID_FIELDS"
    });
  }
  if (o.transactionId !== directoryId) {
    throw new LauncherError(ErrorCode.TRANSACTION_INVALID, "transactionId mismatch", {
      reason: "TRANSACTION_ID_MISMATCH"
    });
  }
  if (o.operation !== "install" && o.operation !== "update" && o.operation !== "repair") {
    throw new LauncherError(ErrorCode.TRANSACTION_INVALID, "invalid transaction operation", {
      reason: "INVALID_FIELDS"
    });
  }
  if (typeof o.channel !== "string" || !o.channel || o.channel.length > 64) {
    throw new LauncherError(ErrorCode.TRANSACTION_INVALID, "invalid channel", {
      reason: "INVALID_FIELDS"
    });
  }
  if (!(o.packVersion === null || typeof o.packVersion === "string")) {
    throw new LauncherError(ErrorCode.TRANSACTION_INVALID, "invalid packVersion", {
      reason: "INVALID_FIELDS"
    });
  }
  if (
    !(
      o.releaseSequence === null ||
      (typeof o.releaseSequence === "number" &&
        Number.isInteger(o.releaseSequence) &&
        o.releaseSequence >= 0)
    )
  ) {
    throw new LauncherError(ErrorCode.TRANSACTION_INVALID, "invalid releaseSequence", {
      reason: "INVALID_FIELDS"
    });
  }
  if (typeof o.createdAt !== "string" || !o.createdAt) {
    throw new LauncherError(ErrorCode.TRANSACTION_INVALID, "invalid createdAt", {
      reason: "INVALID_FIELDS"
    });
  }
  if (typeof o.updatedAt !== "string" || !o.updatedAt) {
    throw new LauncherError(ErrorCode.TRANSACTION_INVALID, "invalid updatedAt", {
      reason: "INVALID_FIELDS"
    });
  }
  if (typeof o.phase !== "string" || !TRANSACTION_PHASES.has(o.phase as TransactionPhase)) {
    throw new LauncherError(ErrorCode.TRANSACTION_INVALID, "invalid phase", {
      reason: "INVALID_PHASE"
    });
  }

  return {
    schemaVersion: 1,
    transactionId: o.transactionId,
    operation: o.operation,
    channel: o.channel,
    packVersion: o.packVersion,
    releaseSequence: o.releaseSequence,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    phase: o.phase as TransactionPhase
  };
}

/**
 * Strict transaction tree scan.
 * metadata.json is recovery SoT; journal.json is diagnostic-only (corruption alone does not block).
 */
export async function scanTransactions(paths: InstancePaths): Promise<TransactionScanResult> {
  const root = OrchestratorTransaction.transactionsRoot(paths);
  let names: string[];
  try {
    names = await readdir(root);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { orphans: [], committed: [], corrupt: [] };
    }
    throw e;
  }

  const orphans: TransactionMetadata[] = [];
  const committed: TransactionMetadata[] = [];
  const corrupt: CorruptTransactionEntry[] = [];

  for (const name of names.sort()) {
    if (!isSafeTransactionDirectoryId(name)) {
      corrupt.push({ directoryId: "unsafe", reason: "INVALID_FIELDS" });
      continue;
    }
    const dirPath = path.join(root, name);
    try {
      const st = await stat(dirPath);
      if (!st.isDirectory()) {
        corrupt.push({ directoryId: name, reason: "NOT_A_DIRECTORY" });
        continue;
      }
    } catch {
      corrupt.push({ directoryId: name, reason: "UNREADABLE_METADATA" });
      continue;
    }

    let rawText: string;
    try {
      rawText = await readFile(path.join(dirPath, "metadata.json"), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        corrupt.push({ directoryId: name, reason: "MISSING_METADATA" });
      } else {
        corrupt.push({ directoryId: name, reason: "UNREADABLE_METADATA" });
      }
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText) as unknown;
    } catch {
      corrupt.push({ directoryId: name, reason: "MALFORMED_JSON" });
      continue;
    }

    try {
      const meta = parseTransactionMetadata(parsed, name);
      if (meta.phase === "COMMITTED") committed.push(meta);
      else orphans.push(meta);
    } catch (e) {
      const reason =
        LauncherError.isLauncherError(e) && typeof e.details.reason === "string"
          ? (e.details.reason as CorruptTransactionReason)
          : "INVALID_FIELDS";
      corrupt.push({ directoryId: name, reason });
    }
  }

  return { orphans, committed, corrupt };
}

/** Valid non-COMMITTED transactions only (excludes corrupt). */
export async function listOrphanTransactions(paths: InstancePaths): Promise<TransactionMetadata[]> {
  const scan = await scanTransactions(paths);
  return scan.orphans;
}

/**
 * Delete only conclusively safe, successfully parsed orphans.
 * Never deletes corrupt / APPLYING / VERIFYING / COMMITTING.
 * Caller must hold exclusive instance lock.
 */
export async function cleanupSafeOrphanTransactions(paths: InstancePaths): Promise<string[]> {
  const scan = await scanTransactions(paths);
  const cleaned: string[] = [];
  for (const meta of scan.orphans) {
    if (!SAFE_CLEANUP_PHASES.has(meta.phase)) continue;
    await rm(path.join(OrchestratorTransaction.transactionsRoot(paths), meta.transactionId), {
      recursive: true,
      force: true
    });
    cleaned.push(meta.transactionId);
  }
  return cleaned;
}
