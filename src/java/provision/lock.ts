/**
 * Provisioning lock for managed Java under runtime java/runtimes/.
 * Same lease/wx/PID stale model as InstanceLock — dedicated file.
 */

import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import { ensureDir } from "../../download/fs/index.js";

export interface JavaProvisionLockInfo {
  schemaVersion: 1;
  pid: number;
  createdAt: string;
  owner: string;
  operation: string;
  leaseId: string;
  identity: string;
}

export interface JavaProvisionLockLease {
  readonly leaseId: string;
  readonly pid: number;
  readonly lockPath: string;
  readonly identity: string;
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function javaProvisionLockPath(javaRuntimesDir: string): string {
  return path.join(javaRuntimesDir, ".provision.lock.json");
}

export async function inspectJavaProvisionLock(
  javaRuntimesDir: string
): Promise<
  | { kind: "ABSENT" }
  | { kind: "LIVE"; info: JavaProvisionLockInfo }
  | { kind: "STALE"; info: JavaProvisionLockInfo }
  | { kind: "MALFORMED" }
> {
  const lockPath = javaProvisionLockPath(javaRuntimesDir);
  let raw: string;
  try {
    raw = await readFile(lockPath, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { kind: "ABSENT" };
    return { kind: "MALFORMED" };
  }
  try {
    const info = JSON.parse(raw) as JavaProvisionLockInfo;
    if (
      info?.schemaVersion !== 1 ||
      typeof info.pid !== "number" ||
      typeof info.leaseId !== "string" ||
      typeof info.identity !== "string"
    ) {
      return { kind: "MALFORMED" };
    }
    return isPidAlive(info.pid) ? { kind: "LIVE", info } : { kind: "STALE", info };
  } catch {
    return { kind: "MALFORMED" };
  }
}

export async function acquireJavaProvisionLock(
  javaRuntimesDir: string,
  identity: string,
  opts: { forceStale?: boolean; owner?: string } = {}
): Promise<JavaProvisionLockLease> {
  await ensureDir(javaRuntimesDir);
  const lockPath = javaProvisionLockPath(javaRuntimesDir);
  const inspection = await inspectJavaProvisionLock(javaRuntimesDir);
  if (inspection.kind === "MALFORMED") {
    if (!opts.forceStale) {
      throw new LauncherError(ErrorCode.JAVA_PROVISION_BUSY, "malformed Java provision lock", {
        malformed: true
      });
    }
    await rm(lockPath, { force: true });
  } else if (inspection.kind === "LIVE") {
    throw new LauncherError(ErrorCode.JAVA_PROVISION_BUSY, "Java provisioning already in progress", {
      identity: inspection.info.identity,
      operation: inspection.info.operation
    });
  } else if (inspection.kind === "STALE") {
    if (!opts.forceStale) {
      throw new LauncherError(ErrorCode.JAVA_PROVISION_BUSY, "stale Java provision lock present", {
        staleLikely: true,
        identity: inspection.info.identity
      });
    }
    await rm(lockPath, { force: true });
  }

  const leaseId = randomUUID();
  const info: JavaProvisionLockInfo = {
    schemaVersion: 1,
    pid: process.pid,
    createdAt: new Date().toISOString(),
    owner: opts.owner ?? `pid:${process.pid}`,
    operation: "java-provision",
    leaseId,
    identity
  };
  try {
    await writeFile(lockPath, JSON.stringify(info, null, 2) + "\n", { flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") {
      throw new LauncherError(ErrorCode.JAVA_PROVISION_BUSY, "Java provision lock race lost", {});
    }
    throw new LauncherError(ErrorCode.JAVA_PROVISION_FS_ERROR, "unable to create Java provision lock", {
      errno: (e as NodeJS.ErrnoException).code
    });
  }
  return { leaseId, pid: info.pid, lockPath, identity };
}

export async function releaseJavaProvisionLock(lease: JavaProvisionLockLease): Promise<void> {
  const inspection = await inspectJavaProvisionLock(path.dirname(lease.lockPath));
  if (inspection.kind === "ABSENT") return;
  if (inspection.kind === "MALFORMED" || inspection.kind === "STALE") {
    await rm(lease.lockPath, { force: true });
    return;
  }
  if (inspection.info.leaseId !== lease.leaseId || inspection.info.pid !== lease.pid) {
    throw new LauncherError(ErrorCode.JAVA_PROVISION_BUSY, "Java provision lock ownership mismatch", {});
  }
  await rm(lease.lockPath, { force: true });
}
