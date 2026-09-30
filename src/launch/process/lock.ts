import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import { ensureDir, writeFileAtomic } from "../../download/fs/index.js";
import type { InstancePaths } from "../../instance/layout/index.js";
import path from "node:path";

/**
 * Same-process serialization for a lock file path.
 * Prevents inspect→rm TOCTOU where force-stale takeover replaces lease A with B
 * between ownership check and unlink (completion release runs without InstanceLock).
 *
 * Cross-process coordination still relies on InstanceLock for PLAY/mutate acquire;
 * this mutex alone is not a cross-process atomic filesystem primitive.
 */
const gameLockOpChains = new Map<string, Promise<unknown>>();

async function withGameLockFileOp<T>(lockFilePath: string, fn: () => Promise<T>): Promise<T> {
  const key = path.resolve(lockFilePath);
  const prev = gameLockOpChains.get(key) ?? Promise.resolve();
  let unlock!: () => void;
  const hold = new Promise<void>((r) => {
    unlock = r;
  });
  // Successors await `hold` after `prev` completes (errors swallowed so queue never stalls).
  gameLockOpChains.set(
    key,
    prev.then(
      () => hold,
      () => hold
    )
  );
  await prev.then(
    () => undefined,
    () => undefined
  );
  try {
    return await fn();
  } finally {
    unlock();
  }
}

/** Test-only hooks — never use in production paths. */
export const gameProcessLockTestHooks: {
  /** Invoked after releaseLease ownership is verified, before rm (inside serialized section). */
  afterReleaseOwnershipVerified?: () => Promise<void>;
} = {};

/**
 * schemaVersion 3 — leaseId is the ownership authority (same-process safe).
 * gamePid remains the primary *liveness* signal once bound.
 *
 * LIMITATION: PID alone is not a perfect identity (PID reuse). We do not
 * verify process creation time portably. Never auto-clear an ambiguous lock
 * based on age alone; forceStale remains explicit.
 *
 * Coordination:
 * - PLAY acquire / mutate takeover occur while InstanceLock is held.
 * - Completion releaseLease must not delete a replacement lease (exact leaseId
 *   match + same-process file op serialization).
 */
export interface GameProcessLockInfo {
  schemaVersion: 3;
  launcherPid: number;
  leaseId: string;
  /** null while launch is reserved but game not yet spawned. */
  gamePid: number | null;
  createdAt: string;
  owner: string;
  operation: string;
}

/** Safe observational view — no paths, no raw file content. */
export interface SafeGameLockView {
  schemaVersion: number;
  launcherPid: number;
  leaseId: string | null;
  gamePid: number | null;
  createdAt: string;
  operation: string;
  owner: string;
}

export type GameProcessLockInspection =
  | { status: "ABSENT" }
  | { status: "ACTIVE"; lock: SafeGameLockView }
  | { status: "STALE"; lock: SafeGameLockView }
  | { status: "MALFORMED" };

export interface GameProcessLockLease {
  readonly leaseId: string;
  readonly launcherPid: number;
}

/**
 * Distinct from installation InstanceLock.
 * Prevents two concurrent game launches for the same instance.
 *
 * Policy:
 * - ACTIVE: always block (forceStale cannot override live process)
 * - STALE / MALFORMED: block by default; forceStale may clear
 * - ABSENT: only when file truly missing (ENOENT)
 */
export class GameProcessLock {
  /** Last lease acquired on this instance — for legacy bindGamePid(pid)/release(). */
  private heldLease: GameProcessLockLease | null = null;

  constructor(private readonly paths: InstancePaths) {}

  lockFile(): string {
    return path.join(this.paths.launcherDir(), "game-process.lock.json");
  }

  /**
   * Reserve launch slot (launcherPid + leaseId, gamePid null).
   * Returns ownership lease — required for bind/release.
   */
  async acquire(
    operation: string,
    opts: { forceStale?: boolean; owner?: string } = {}
  ): Promise<GameProcessLockLease> {
    await ensureDir(this.paths.launcherDir());
    return withGameLockFileOp(this.lockFile(), async () => {
      const inspection = await this.inspectDetailedUnlocked();

      if (inspection.status === "ACTIVE") {
        throw new LauncherError(ErrorCode.GAME_PROCESS_LOCKED, "game process lock held", {
          lock: inspection.lock
        });
      }
      if (inspection.status === "STALE" || inspection.status === "MALFORMED") {
        if (!opts.forceStale) {
          throw new LauncherError(
            inspection.status === "MALFORMED"
              ? ErrorCode.GAME_PROCESS_LOCK_INVALID
              : ErrorCode.GAME_PROCESS_LOCKED,
            inspection.status === "MALFORMED"
              ? "malformed game lock present; pass forceStale to clear"
              : "stale game lock present; pass forceStale to clear",
            {
              ...(inspection.status === "STALE" ? { lock: inspection.lock, staleLikely: true } : {}),
              malformed: inspection.status === "MALFORMED"
            }
          );
        }
        await rm(this.lockFile(), { force: true });
      }

      const leaseId = randomUUID();
      const info: GameProcessLockInfo = {
        schemaVersion: 3,
        launcherPid: process.pid,
        leaseId,
        gamePid: null,
        createdAt: new Date().toISOString(),
        owner: opts.owner ?? `launcher:${process.pid}`,
        operation
      };
      try {
        await writeFile(this.lockFile(), JSON.stringify(info, null, 2) + "\n", { flag: "wx" });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EEXIST") {
          throw new LauncherError(ErrorCode.GAME_PROCESS_LOCKED, "game lock race lost", {});
        }
        throw e;
      }

      const lease: GameProcessLockLease = { leaseId, launcherPid: info.launcherPid };
      this.heldLease = lease;
      return lease;
    });
  }

  /**
   * Bind gamePid with exact lease ownership.
   * Overload: bindGamePid(lease, gamePid) — preferred.
   * Legacy: bindGamePid(gamePid) uses last acquire() on this instance.
   */
  async bindGamePid(leaseOrPid: GameProcessLockLease | number, gamePid?: number): Promise<void> {
    if (typeof leaseOrPid === "number") {
      if (!this.heldLease) {
        throw new LauncherError(
          ErrorCode.GAME_PROCESS_LOCK_UPDATE_FAILED,
          "cannot bind gamePid: no lease held on this lock instance",
          {}
        );
      }
      return this.bindGamePidWithLease(this.heldLease, leaseOrPid);
    }
    if (typeof gamePid !== "number") {
      throw new LauncherError(ErrorCode.GAME_PROCESS_LOCK_UPDATE_FAILED, "invalid gamePid", {});
    }
    return this.bindGamePidWithLease(leaseOrPid, gamePid);
  }

  private async bindGamePidWithLease(lease: GameProcessLockLease, gamePid: number): Promise<void> {
    if (!Number.isInteger(gamePid) || gamePid <= 0) {
      throw new LauncherError(ErrorCode.GAME_PROCESS_LOCK_UPDATE_FAILED, "invalid gamePid", {});
    }
    return withGameLockFileOp(this.lockFile(), async () => {
      const inspection = await this.inspectDetailedUnlocked();
      if (inspection.status === "MALFORMED") {
        throw new LauncherError(
          ErrorCode.GAME_PROCESS_LOCK_UPDATE_FAILED,
          "cannot bind gamePid: lock malformed",
          {}
        );
      }
      if (inspection.status === "ABSENT") {
        throw new LauncherError(
          ErrorCode.GAME_PROCESS_LOCK_UPDATE_FAILED,
          "cannot bind gamePid: lock not held",
          {}
        );
      }
      const existing = inspection.lock;
      if (
        existing.launcherPid !== lease.launcherPid ||
        existing.leaseId !== lease.leaseId ||
        lease.launcherPid !== process.pid
      ) {
        throw new LauncherError(
          ErrorCode.GAME_PROCESS_LOCK_UPDATE_FAILED,
          "cannot bind gamePid: lease ownership mismatch",
          { lock: existing }
        );
      }

      const updated: GameProcessLockInfo = {
        schemaVersion: 3,
        launcherPid: lease.launcherPid,
        leaseId: lease.leaseId,
        gamePid,
        createdAt: existing.createdAt,
        owner: existing.owner,
        operation: existing.operation
      };
      try {
        await writeFileAtomic(this.lockFile(), JSON.stringify(updated, null, 2) + "\n");
      } catch {
        throw new LauncherError(
          ErrorCode.GAME_PROCESS_LOCK_UPDATE_FAILED,
          "failed to persist gamePid in lock",
          { phase: "persist_game_pid" }
        );
      }
    });
  }

  /** Exact lease release — no pid-only fallback.
   *
   * CROSS-PROCESS WARNING: inspect→rm is not atomic across processes.
   * Public PLAY / mutate ownership transitions must hold InstanceLock
   * (see releaseGameProcessLockCoordinated). This method remains the low-level
   * unlink primitive for callers that already serialize via InstanceLock.
   * Legacy runPreparedLaunch may call it without InstanceLock — not safe for
   * concurrent multi-process orchestration.
   */
  async releaseLease(lease: GameProcessLockLease): Promise<void> {
    return withGameLockFileOp(this.lockFile(), async () => {
      const inspection = await this.inspectDetailedUnlocked();
      if (inspection.status === "ABSENT") return;
      if (inspection.status === "MALFORMED") {
        throw new LauncherError(
          ErrorCode.GAME_PROCESS_LOCK_INVALID,
          "refusing to release malformed game lock via lease API",
          { malformed: true }
        );
      }
      if (
        inspection.lock.launcherPid !== lease.launcherPid ||
        inspection.lock.leaseId !== lease.leaseId ||
        lease.launcherPid !== process.pid
      ) {
        throw new LauncherError(
          ErrorCode.GAME_PROCESS_LOCKED,
          "refusing to release game lock: lease ownership mismatch",
          { lock: inspection.lock }
        );
      }
      if (gameProcessLockTestHooks.afterReleaseOwnershipVerified) {
        await gameProcessLockTestHooks.afterReleaseOwnershipVerified();
      }
      // Re-verify ownership after optional test pause (still inside serialized section).
      const again = await this.inspectDetailedUnlocked();
      if (
        again.status === "ABSENT" ||
        again.status === "MALFORMED" ||
        again.lock.leaseId !== lease.leaseId ||
        again.lock.launcherPid !== lease.launcherPid
      ) {
        throw new LauncherError(
          ErrorCode.GAME_PROCESS_LOCKED,
          "refusing to release game lock: lease ownership mismatch",
          again.status === "ACTIVE" || again.status === "STALE" ? { lock: again.lock } : {}
        );
      }
      await rm(this.lockFile(), { force: true });
      if (this.heldLease?.leaseId === lease.leaseId) {
        this.heldLease = null;
      }
    });
  }

  /**
   * Legacy release: uses last acquire() lease on this instance.
   * Play must use releaseLease(lease) — never fall back from failed releaseLease.
   */
  async release(): Promise<void> {
    if (!this.heldLease) {
      throw new LauncherError(
        ErrorCode.GAME_PROCESS_LOCKED,
        "refusing to release game lock: no lease held on this lock instance",
        {}
      );
    }
    await this.releaseLease(this.heldLease);
  }

  /** Fail-closed observational API (read-only; not serialized). */
  async inspectDetailed(): Promise<GameProcessLockInspection> {
    return this.inspectDetailedUnlocked();
  }

  private async inspectDetailedUnlocked(): Promise<GameProcessLockInspection> {
    let rawText: string;
    try {
      rawText = await readFile(this.lockFile(), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return { status: "ABSENT" };
      return { status: "MALFORMED" };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText) as unknown;
    } catch {
      return { status: "MALFORMED" };
    }

    let info: GameProcessLockInfo;
    try {
      info = parseAndNormalizeGameLock(parsed);
    } catch {
      return { status: "MALFORMED" };
    }

    const view = toSafeView(info);
    return classifyLock(info) === "active"
      ? { status: "ACTIVE", lock: view }
      : { status: "STALE", lock: view };
  }

  /**
   * Compatibility wrapper — includes MALFORMED (never maps malformed → ABSENT).
   */
  async inspect(): Promise<"ABSENT" | "ACTIVE" | "STALE" | "MALFORMED"> {
    return (await this.inspectDetailed()).status;
  }
}

function parseAndNormalizeGameLock(raw: unknown): GameProcessLockInfo {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("not object");
  }
  const o = raw as Record<string, unknown>;
  const schemaVersion = o.schemaVersion;

  if (schemaVersion === 3) {
    return parseV3(o);
  }
  if (schemaVersion === 2) {
    return normalizeV2(o);
  }
  if (schemaVersion === 1) {
    return normalizeV1(o);
  }
  throw new Error("unknown schema");
}

function parseV3(o: Record<string, unknown>): GameProcessLockInfo {
  if (!isPositiveInt(o.launcherPid)) throw new Error("bad launcherPid");
  if (typeof o.leaseId !== "string" || !isSafeLeaseId(o.leaseId)) throw new Error("bad leaseId");
  if (!(o.gamePid === null || isPositiveInt(o.gamePid))) throw new Error("bad gamePid");
  if (!isValidCreatedAt(o.createdAt)) throw new Error("bad createdAt");
  if (typeof o.owner !== "string" || !o.owner) throw new Error("bad owner");
  if (typeof o.operation !== "string" || !o.operation) throw new Error("bad operation");
  return {
    schemaVersion: 3,
    launcherPid: o.launcherPid,
    leaseId: o.leaseId,
    gamePid: o.gamePid,
    createdAt: o.createdAt,
    owner: o.owner,
    operation: o.operation
  };
}

function normalizeV2(o: Record<string, unknown>): GameProcessLockInfo {
  if (!isPositiveInt(o.launcherPid)) throw new Error("bad launcherPid");
  if (!(o.gamePid === null || isPositiveInt(o.gamePid))) throw new Error("bad gamePid");
  if (!isValidCreatedAt(o.createdAt)) throw new Error("bad createdAt");
  if (typeof o.owner !== "string" || !o.owner) throw new Error("bad owner");
  if (typeof o.operation !== "string" || !o.operation) throw new Error("bad operation");
  // Legacy v2: no leaseId — use deterministic placeholder for safe view only.
  // Cannot satisfy lease APIs; forceStale required to replace with v3.
  return {
    schemaVersion: 3,
    launcherPid: o.launcherPid,
    leaseId: "legacy-v2",
    gamePid: o.gamePid,
    createdAt: o.createdAt,
    owner: o.owner,
    operation: o.operation
  };
}

function normalizeV1(o: Record<string, unknown>): GameProcessLockInfo {
  if (!isPositiveInt(o.pid)) throw new Error("bad pid");
  if (!isValidCreatedAt(o.createdAt)) throw new Error("bad createdAt");
  if (typeof o.owner !== "string" || !o.owner) throw new Error("bad owner");
  if (typeof o.operation !== "string" || !o.operation) throw new Error("bad operation");
  return {
    schemaVersion: 3,
    launcherPid: o.pid,
    leaseId: "legacy-v1",
    gamePid: null,
    createdAt: o.createdAt,
    owner: o.owner,
    operation: o.operation
  };
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

function isSafeLeaseId(id: string): boolean {
  return /^[a-zA-Z0-9._-]{8,128}$/.test(id) && !id.includes("..");
}

function isValidCreatedAt(v: unknown): v is string {
  if (typeof v !== "string" || !v) return false;
  const t = Date.parse(v);
  return Number.isFinite(t);
}

function classifyLock(lock: GameProcessLockInfo): "active" | "stale" {
  if (lock.gamePid !== null && isPidAlive(lock.gamePid)) {
    return "active";
  }
  if (lock.gamePid === null && isPidAlive(lock.launcherPid)) {
    return "active";
  }
  return "stale";
}

function toSafeView(lock: GameProcessLockInfo): SafeGameLockView {
  return {
    schemaVersion: lock.schemaVersion,
    launcherPid: lock.launcherPid,
    leaseId: lock.leaseId.startsWith("legacy-") ? null : lock.leaseId,
    gamePid: lock.gamePid,
    createdAt: lock.createdAt,
    operation: lock.operation,
    owner: lock.owner
  };
}

export function isPidAlive(pid: number): boolean {
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
