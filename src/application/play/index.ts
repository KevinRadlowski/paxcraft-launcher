export type {
  PlayPhase,
  PlayRequest,
  PlayResult,
  PlayDependencies,
  RunningGame,
  GameExitResult
} from "./types.js";
export { PlaySessionCache } from "./types.js";
export { startGame, playAndWait } from "./orchestrator.js";
export { assertPlayReadiness, mapStatusToPlayError } from "./readiness.js";
export { resolvePlayAccount, markAccountLastUsed } from "./account.js";
export { resolvePlaySession, coldRestorePlaySession } from "./session.js";
export { releaseGameProcessLockCoordinated } from "./gameLockCleanup.js";
export type {
  CoordinatedGameLockReleaseOutcome,
  CoordinatedGameLockReleaseOptions
} from "./gameLockCleanup.js";
export { emitPlayProgress } from "./progress.js";
export {
  runningGameToJson,
  playResultToJson,
  formatPlayHuman,
  formatExitHuman
} from "./diagnostics.js";
