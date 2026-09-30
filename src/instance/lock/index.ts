import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import { ensureDir, writeFileAtomic } from "../../download/fs/index.js";
import type { InstancePaths } from "../layout/index.js";

export interface InstanceLockInfo {
  schemaVersion: 1;
  pid: number;
  createdAt: string;
  owner: string;
  operation: string;
  /** Opaque lease id — required to prove lock ownership to apply layer. */
  leaseId: string;
}

export interface InstanceLockLease {
  readonly leaseId: string;
  readonly pid: number;
  readonly operation: string;
  readonly instanceRoot: string;
}

export type InstanceLockInspection =
  | { kind: "ABSENT" }
  | { kind: "LIVE"; info: InstanceLockInfo }
  | { kind: "STALE"; info: InstanceLockInfo }
  | { kind: "MALFORMED" };

/**
 * Local instance lock.
 *
 * Stale strategy (documented, non-blind):
 * - If lock exists and PID is alive → INSTANCE_LOCKED
 * - If lock exists and PID is dead (or unreadable) AND forceStale=true → remove and acquire
 * - Without forceStale, dead PID still → INSTANCE_LOCKED with details.staleLikely=true
 * - Malformed lock file → fail closed (not treated as absent)
 */
export class InstanceLock {
  constructor(private readonly paths: InstancePaths) {}

  async acquire(
    operation: string,
    opts: { forceStale?: boolean; owner?: string } = {}
  ): Promise<InstanceLockLease> {
    await ensureDir(this.paths.launcherDir());
    const inspection = await inspectInstanceLock(this.paths);
    if (inspection.kind === "MALFORMED") {
      if (!opts.forceStale) {
        throw new LauncherError(ErrorCode.INSTANCE_LOCKED, "malformed instance lock present", {
          malformed: true
        });
      }
      await rm(this.paths.lockFile(), { force: true });
    } else if (inspection.kind === "LIVE") {
      throw new LauncherError(ErrorCode.INSTANCE_LOCKED, "instance is locked by another process", {
        operation: inspection.info.operation
      });
    } else if (inspection.kind === "STALE") {
      if (!opts.forceStale) {
        throw new LauncherError(ErrorCode.INSTANCE_LOCKED, "stale lock present; pass forceStale to clear", {
          staleLikely: true,
          operation: inspection.info.operation
        });
      }
      await rm(this.paths.lockFile(), { force: true });
    }

    const leaseId = randomUUID();
    const info: InstanceLockInfo = {
      schemaVersion: 1,
      pid: process.pid,
      createdAt: new Date().toISOString(),
      owner: opts.owner ?? `pid:${process.pid}`,
      operation,
      leaseId
    };
    try {
      await writeFile(this.paths.lockFile(), JSON.stringify(info, null, 2) + "\n", { flag: "wx" });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") {
        throw new LauncherError(ErrorCode.INSTANCE_LOCKED, "instance lock race lost", {});
      }
      throw e;
    }

    return {
      leaseId,
      pid: info.pid,
      operation,
      instanceRoot: this.paths.root
    };
  }

  async releaseLease(lease: InstanceLockLease): Promise<void> {
    const info = await assertValidLockLease(this.paths, lease);
    if (info.leaseId !== lease.leaseId || info.pid !== lease.pid) {
      throw new LauncherError(ErrorCode.INSTANCE_LOCKED, "lock lease ownership mismatch on release", {});
    }
    await rm(this.paths.lockFile(), { force: true });
  }

  /**
   * Legacy release: removes lock if owned by this process PID.
   * Orchestrator must NOT use this after a failed releaseLease.
   */
  async release(): Promise<void> {
    const inspection = await inspectInstanceLock(this.paths);
    if (inspection.kind === "ABSENT") return;
    if (inspection.kind === "MALFORMED") {
      throw new LauncherError(ErrorCode.INSTANCE_LOCKED, "refusing to release malformed lock via legacy API", {
        malformed: true
      });
    }
    if (inspection.info.pid !== process.pid) {
      throw new LauncherError(ErrorCode.INSTANCE_LOCKED, "refusing to release lock owned by another pid", {});
    }
    await rm(this.paths.lockFile(), { force: true });
  }
}

/** Strict lock.json parse — never trust cast. */
export function parseInstanceLockInfo(raw: unknown): InstanceLockInfo {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new LauncherError(ErrorCode.INSTANCE_LOCKED, "lock is not an object", { malformed: true });
  }
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== 1) {
    throw new LauncherError(ErrorCode.INSTANCE_LOCKED, "unsupported lock schema", { malformed: true });
  }
  if (typeof o.pid !== "number" || !Number.isInteger(o.pid) || o.pid <= 0) {
    throw new LauncherError(ErrorCode.INSTANCE_LOCKED, "invalid lock pid", { malformed: true });
  }
  if (typeof o.createdAt !== "string" || !o.createdAt) {
    throw new LauncherError(ErrorCode.INSTANCE_LOCKED, "invalid lock createdAt", { malformed: true });
  }
  if (typeof o.owner !== "string" || !o.owner) {
    throw new LauncherError(ErrorCode.INSTANCE_LOCKED, "invalid lock owner", { malformed: true });
  }
  if (typeof o.operation !== "string" || !o.operation) {
    throw new LauncherError(ErrorCode.INSTANCE_LOCKED, "invalid lock operation", { malformed: true });
  }
  if (typeof o.leaseId !== "string" || !isSafeLeaseId(o.leaseId)) {
    throw new LauncherError(ErrorCode.INSTANCE_LOCKED, "invalid lock leaseId", { malformed: true });
  }
  return {
    schemaVersion: 1,
    pid: o.pid,
    createdAt: o.createdAt,
    owner: o.owner,
    operation: o.operation,
    leaseId: o.leaseId
  };
}

export async function inspectInstanceLock(paths: InstancePaths): Promise<InstanceLockInspection> {
  let rawText: string;
  try {
    rawText = await readFile(paths.lockFile(), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { kind: "ABSENT" };
    return { kind: "MALFORMED" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch {
    return { kind: "MALFORMED" };
  }
  let info: InstanceLockInfo;
  try {
    info = parseInstanceLockInfo(parsed);
  } catch {
    return { kind: "MALFORMED" };
  }
  return isPidAlive(info.pid) ? { kind: "LIVE", info } : { kind: "STALE", info };
}

/** @deprecated Prefer inspectInstanceLock — returns LIVE info only, null if absent; throws on malformed. */
export async function peekInstanceLock(paths: InstancePaths): Promise<InstanceLockInfo | null> {
  const inspection = await inspectInstanceLock(paths);
  if (inspection.kind === "ABSENT") return null;
  if (inspection.kind === "MALFORMED") {
    throw new LauncherError(ErrorCode.INSTANCE_LOCKED, "malformed instance lock", { malformed: true });
  }
  return inspection.info;
}

export async function assertValidLockLease(
  paths: InstancePaths,
  lease: InstanceLockLease
): Promise<InstanceLockInfo> {
  if (lease.instanceRoot !== paths.root) {
    throw new LauncherError(ErrorCode.INSTANCE_LOCKED, "lock lease instance root mismatch", {});
  }
  if (lease.pid !== process.pid) {
    throw new LauncherError(ErrorCode.INSTANCE_LOCKED, "lock lease pid mismatch", {});
  }
  const inspection = await inspectInstanceLock(paths);
  if (inspection.kind !== "LIVE" && inspection.kind !== "STALE") {
    throw new LauncherError(ErrorCode.INSTANCE_LOCKED, "lock lease not held", {
      malformed: inspection.kind === "MALFORMED"
    });
  }
  if (inspection.info.leaseId !== lease.leaseId || inspection.info.pid !== lease.pid) {
    throw new LauncherError(ErrorCode.INSTANCE_LOCKED, "lock lease invalid or stolen", {});
  }
  return inspection.info;
}

function isSafeLeaseId(id: string): boolean {
  return /^[a-zA-Z0-9._-]{8,128}$/.test(id) && !id.includes("..");
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "EPERM") return true;
    return false;
  }
}

void writeFileAtomic;
