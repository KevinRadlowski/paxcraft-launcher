import type { GameExitResult, PlayResult, RunningGame } from "./types.js";

/** Safe CLI / UI JSON — never tokens. */
export function runningGameToJson(game: RunningGame): Record<string, unknown> {
  return {
    operationId: game.operationId,
    outcome: "STARTED",
    gamePid: game.gamePid,
    accountId: game.accountId,
    minecraftUsername: game.minecraftUsername,
    minecraftUuid: game.minecraftUuid,
    packVersion: game.packVersion,
    releaseSequence: game.releaseSequence,
    startedAt: game.startedAt
  };
}

export function playResultToJson(result: PlayResult): Record<string, unknown> {
  return {
    operationId: result.operationId,
    outcome: result.outcome,
    gamePid: result.gamePid,
    accountId: result.accountId,
    minecraftUsername: result.minecraftUsername,
    minecraftUuid: result.minecraftUuid,
    packVersion: result.packVersion,
    releaseSequence: result.releaseSequence,
    ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
    ...(result.signal !== undefined ? { signal: result.signal } : {}),
    ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {})
  };
}

export function formatPlayHuman(result: PlayResult): string {
  if (result.outcome === "STARTED") {
    return `PLAY STARTED pid=${result.gamePid} ${result.minecraftUsername} ${result.packVersion}`;
  }
  return `PLAY EXITED pid=${result.gamePid} exit=${result.exitCode ?? "null"} ${result.packVersion}`;
}

export function formatExitHuman(exit: GameExitResult): string {
  return `GAME_EXITED kind=${exit.kind} code=${exit.exitCode ?? "null"} durationMs=${exit.durationMs}`;
}
