import type { ProgressEmitter } from "../instance/events/index.js";
import type { LaunchSpec } from "./types.js";
import { buildLaunchSpec, type BuildLaunchSpecOptions } from "./spec.js";
import { sanitizeLaunchSpecForLogging } from "./sanitize.js";
import {
  assertLaunchReady,
  validateLaunchReadiness,
  type LaunchReadinessResult
} from "./readiness.js";
import type { RuntimeAuditFinding } from "../minecraft/audit/index.js";
import type { MinecraftProcessRunner, GameProcessResult } from "./process/runner.js";
import { GameProcessLock } from "./process/lock.js";
import type { InstancePaths } from "../instance/layout/index.js";
import { materializeLaunchArguments } from "./argfile.js";
import { ErrorCode, LauncherError } from "../core/errors/index.js";

export interface PreparedLaunch {
  readonly spec: LaunchSpec;
  readonly secrets: readonly string[];
  readonly readiness: LaunchReadinessResult;
  readonly sanitizedSummary: ReturnType<typeof sanitizeLaunchSpecForLogging>;
  /** True when spawn will need an argfile — file is NOT created at prepare time. */
  readonly argfileRequired: boolean;
}

export interface PrepareLaunchOptions extends BuildLaunchSpecOptions {
  runtimeFindings: RuntimeAuditFinding[];
  instanceFindings?: Array<{ status: string; id?: string }>;
  /** When true, skip readiness assert (still compute). Default false. */
  allowNotReady?: boolean;
  emitter?: ProgressEmitter;
}

export async function prepareLaunch(opts: PrepareLaunchOptions): Promise<PreparedLaunch> {
  opts.emitter?.emit("LAUNCH_PREPARATION_STARTED", {
    minecraftVersion: opts.runtime.minecraftVersion,
    fabricLoaderVersion: opts.runtime.fabricLoaderVersion
  });

  const readiness = validateLaunchReadiness({
    runtimeFindings: opts.runtimeFindings,
    ...(opts.instanceFindings ? { instanceFindings: opts.instanceFindings } : {}),
    runtime: opts.runtime,
    java: opts.java,
    identity: opts.identity,
    instanceRoot: opts.instanceRoot
  });

  if (!opts.allowNotReady) {
    assertLaunchReady(readiness);
  }

  const spec = await buildLaunchSpec(opts);
  const secrets = [opts.identity.accessToken];
  const sanitizedSummary = sanitizeLaunchSpecForLogging(spec, secrets);

  opts.emitter?.emit("LAUNCH_SPEC_READY", {
    mainClass: spec.mainClass,
    javaExecutable: spec.javaExecutable,
    memory: spec.memory,
    classpathEntryCount: spec.classpathEntries.length,
    jvmArgCount: spec.jvmArgs.length,
    gameArgCount: spec.gameArgs.length,
    argfileRequired: !!spec.argfilePlan,
    dryRunSafe: true
  });

  return Object.freeze({
    spec,
    secrets: Object.freeze(secrets),
    readiness,
    sanitizedSummary,
    argfileRequired: !!spec.argfilePlan
  });
}

export interface RunPreparedLaunchOptions {
  prepared: PreparedLaunch;
  runner: MinecraftProcessRunner;
  instancePaths: InstancePaths;
  emitter?: ProgressEmitter;
  /** Acquire game process lock (default true). */
  acquireLock?: boolean;
  forceStaleLock?: boolean;
}

/**
 * Materialize argfile (if planned) → spawn → cleanup argfile → release lock.
 * Reservation acquired before materialize; gamePid bound after spawn.
 *
 * LEGACY / low-level (0.3B): when acquireLock=true this path uses GameProcessLock
 * without InstanceLock coordination. It is **not** safe for concurrent multi-process
 * orchestration (cross-process force-stale vs release TOCTOU).
 *
 * Public application PLAY must use `startGame` / `playAndWait` (0.5B), which
 * serialize all game-lock ownership transitions under InstanceLock.
 * Do not nest this under an already-held InstanceLock (would risk deadlock if
 * hardened later). Prefer the hardened 0.5B API for product workflows.
 */
export async function runPreparedLaunch(opts: RunPreparedLaunchOptions): Promise<GameProcessResult> {
  assertLaunchReady(opts.prepared.readiness);
  const lock = new GameProcessLock(opts.instancePaths);
  const acquire = opts.acquireLock !== false;
  let gameLease: Awaited<ReturnType<GameProcessLock["acquire"]>> | null = null;
  if (acquire) {
    gameLease = await lock.acquire("game-launch", { forceStale: opts.forceStaleLock === true });
  }

  let materialized: Awaited<ReturnType<typeof materializeLaunchArguments>> | null = null;
  try {
    materialized = await materializeLaunchArguments({
      logicalArgv: opts.prepared.spec.argv,
      ...(opts.prepared.spec.argfilePlan ? { argfilePlan: opts.prepared.spec.argfilePlan } : {})
    });

    const lease = gameLease;
    const result = await opts.runner.run(opts.prepared.spec, {
      secrets: [...opts.prepared.secrets],
      ...(opts.emitter ? { emitter: opts.emitter } : {}),
      spawnArgv: materialized.spawnArgv,
      ...(acquire && lease
        ? {
            onSpawned: async (gamePid: number) => {
              await lock.bindGamePid(lease, gamePid);
            }
          }
        : {})
    });

    return result;
  } catch (e) {
    if (LauncherError.isLauncherError(e)) throw e;
    throw new LauncherError(ErrorCode.GAME_PROCESS_SPAWN_FAILED, "failed to start Minecraft process", {
      phase: "spawn"
    });
  } finally {
    if (materialized) {
      const cleanup = await materialized.cleanup();
      if (!cleanup.cleaned && cleanup.error && opts.emitter) {
        opts.emitter.emit("GAME_PROCESS_FAILED", {
          reason: "argfile_cleanup_failed",
          code: cleanup.error.code
        });
      }
    }
    if (acquire && gameLease) {
      try {
        await lock.releaseLease(gameLease);
      } catch {
        // if lock owned differently, leave for operator
      }
    }
  }
}
