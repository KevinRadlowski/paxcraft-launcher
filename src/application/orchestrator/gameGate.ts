import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import { GameProcessLock } from "../../launch/process/lock.js";
import type { InstancePaths } from "../../instance/layout/index.js";

/**
 * Shared gate: mutating install/update/repair must refuse while Minecraft
 * (or an in-progress game reservation) holds GameProcessLock, and when the
 * game-lock file is STALE or MALFORMED (unknown ownership → fail closed).
 *
 * Lock ordering (global): InstanceLock BEFORE GameProcessLock when both needed.
 */
export async function assertGameProcessNotActive(paths: InstancePaths): Promise<void> {
  const lock = new GameProcessLock(paths);
  const inspection = await lock.inspectDetailed();

  if (inspection.status === "ABSENT") return;

  if (inspection.status === "MALFORMED") {
    throw new LauncherError(
      ErrorCode.GAME_PROCESS_LOCK_INVALID,
      "game process lock is malformed; refuse mutation",
      { gameLock: "MALFORMED" }
    );
  }

  if (inspection.status === "ACTIVE") {
    throw new LauncherError(
      ErrorCode.GAME_ALREADY_RUNNING,
      "instance is in use by a running or reserved Minecraft process",
      { gameLock: "ACTIVE" }
    );
  }

  // STALE — do not silently mutate; operator must clear with explicit force path
  // on the game lock (PLAY forceStaleGameLock) or after confirming no game.
  throw new LauncherError(
    ErrorCode.GAME_ALREADY_RUNNING,
    "stale game process lock present; refuse mutation until cleared",
    { gameLock: "STALE", staleLikely: true }
  );
}
