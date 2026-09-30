import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import type { ProgressEmitter } from "../../instance/events/index.js";
import { InstanceLock, type InstanceLockLease } from "../../instance/lock/index.js";
import type { InstancePaths } from "../../instance/layout/index.js";
import {
  GameProcessLock,
  type GameProcessLockLease
} from "../../launch/process/lock.js";

export type CoordinatedGameLockReleaseOutcome =
  | "released"
  | "already_absent"
  | "ownership_mismatch"
  | "deferred";

export interface CoordinatedGameLockReleaseOptions {
  paths: InstancePaths;
  gameLease: GameProcessLockLease;
  /** Safe owner label — no secrets/paths. */
  operationId?: string;
  emitter?: ProgressEmitter;
  /** Brief retries when InstanceLock is held by another op. */
  retry?: { attempts: number; delayMs: number };
  /**
   * Test-only: after InstanceLock is held and game lease ownership verified,
   * before unlink. Must not be used by production callers.
   */
  afterOwnershipVerifiedUnderInstanceLock?: () => Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Cross-process-safe GameProcessLock release.
 *
 * Lock order (mandatory):
 *   InstanceLock → exact GameProcessLock releaseLease → InstanceLock release
 *
 * Never unlink game-process.lock.json without holding InstanceLock — inspect→rm
 * alone is not atomic across processes.
 *
 * If InstanceLock cannot be acquired (live foreign owner after retries):
 * leave the game lock on disk (fail-closed) and return "deferred".
 */
export async function releaseGameProcessLockCoordinated(
  opts: CoordinatedGameLockReleaseOptions
): Promise<CoordinatedGameLockReleaseOutcome> {
  const attempts = opts.retry?.attempts ?? 40;
  const delayMs = opts.retry?.delayMs ?? 25;
  const instanceLock = new InstanceLock(opts.paths);
  const gameLock = new GameProcessLock(opts.paths);
  const owner = `play-cleanup:${opts.operationId ?? "unknown"}`;

  let cleanupLease: InstanceLockLease | null = null;

  for (let i = 0; i < attempts; i++) {
    try {
      cleanupLease = await instanceLock.acquire("game-cleanup", { owner });
      break;
    } catch (e) {
      const locked =
        LauncherError.isLauncherError(e) && e.code === ErrorCode.INSTANCE_LOCKED;
      if (!locked || i === attempts - 1) {
        opts.emitter?.emit("PLAY_CLEANUP_WARNING", {
          reason: "game_lock_release_deferred",
          ...(opts.operationId ? { operationId: opts.operationId } : {})
        });
        return "deferred";
      }
      await sleep(delayMs);
    }
  }

  if (!cleanupLease) {
    opts.emitter?.emit("PLAY_CLEANUP_WARNING", {
      reason: "game_lock_release_deferred",
      ...(opts.operationId ? { operationId: opts.operationId } : {})
    });
    return "deferred";
  }

  try {
    const inspection = await gameLock.inspectDetailed();
    if (inspection.status === "ABSENT") {
      return "already_absent";
    }
    if (
      inspection.status === "MALFORMED" ||
      inspection.lock.leaseId !== opts.gameLease.leaseId ||
      inspection.lock.launcherPid !== opts.gameLease.launcherPid
    ) {
      return "ownership_mismatch";
    }

    if (opts.afterOwnershipVerifiedUnderInstanceLock) {
      await opts.afterOwnershipVerifiedUnderInstanceLock();
    }

    // Re-check under the same InstanceLock before unlink (foreign force-take
    // cannot proceed while we hold InstanceLock).
    const again = await gameLock.inspectDetailed();
    if (
      again.status === "ABSENT" ||
      again.status === "MALFORMED" ||
      again.lock.leaseId !== opts.gameLease.leaseId ||
      again.lock.launcherPid !== opts.gameLease.launcherPid
    ) {
      return "ownership_mismatch";
    }

    try {
      await gameLock.releaseLease(opts.gameLease);
      return "released";
    } catch {
      opts.emitter?.emit("PLAY_CLEANUP_WARNING", {
        reason: "game_lock_release_deferred",
        ...(opts.operationId ? { operationId: opts.operationId } : {})
      });
      return "deferred";
    }
  } finally {
    try {
      await instanceLock.releaseLease(cleanupLease);
    } catch {
      // exact lease only — never pid-only fallback
    }
  }
}
