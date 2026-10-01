import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import { resolveLatestRelease } from "../../core/resolve/index.js";
import { requireConfiguredDistributionOrigin } from "../../product/paxNetworkConfig.js";
import { InstancePaths } from "../../instance/layout/index.js";
import { InstanceLock } from "../../instance/lock/index.js";
import { defaultRuntimeRoot } from "../../instance/paths/index.js";
import { detectPlatform } from "../../platform/index.js";
import { RuntimePaths } from "../../minecraft/runtime/paths.js";
import { buildRuntimeInstallationPlan } from "../../minecraft/runtime/plan.js";
import { ensureCompatibleJava } from "../../java/provision/index.js";
import { prepareLaunch } from "../../launch/prepare.js";
import { materializeLaunchArguments } from "../../launch/argfile.js";
import { GameProcessLock, type GameProcessLockLease } from "../../launch/process/lock.js";
import { createOperationId } from "../orchestrator/progress.js";
import { assertPlayReadiness } from "./readiness.js";
import { markAccountLastUsed, resolvePlayAccount } from "./account.js";
import { resolvePlaySession } from "./session.js";
import { emitPlayProgress } from "./progress.js";
import { releaseGameProcessLockCoordinated } from "./gameLockCleanup.js";
import type {
  GameExitResult,
  PlayDependencies,
  PlayRequest,
  PlayResult,
  RunningGame
} from "./types.js";

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new LauncherError(ErrorCode.OPERATION_ABORTED, "play aborted", {});
  }
}

function mapInstanceLockError(e: unknown): never {
  if (LauncherError.isLauncherError(e) && e.code === ErrorCode.INSTANCE_LOCKED) {
    throw new LauncherError(ErrorCode.INSTANCE_BUSY, "instance is busy", e.details);
  }
  throw e;
}

/**
 * Start Minecraft for a READY instance.
 *
 * Lock ordering:
 *   START: InstanceLock → GameProcessLock acquire → InstanceLock release → run
 *   EXIT:  InstanceLock (short game-cleanup) → exact GameProcessLock release → InstanceLock release
 *
 * Does NOT auto install/update/repair.
 * Abort after spawn does not kill the game.
 *
 * Ownership boundary:
 * - PRE_SPAWN: failures may release reservation + cleanup argfile
 * - PROCESS_STARTED (after successful runner.start): lease + argfile belong to
 *   RunningGame completion — outer catch must NOT drop protection
 */
export async function startGame(
  req: PlayRequest,
  deps: PlayDependencies
): Promise<RunningGame> {
  const operationId = deps.createOperationId?.() ?? createOperationId();
  const paths = new InstancePaths(req.instancePath);
  const instanceLock = new InstanceLock(paths);
  const gameLock = new GameProcessLock(paths);
  let instanceLease: Awaited<ReturnType<InstanceLock["acquire"]>> | null = null;
  let gameLease: GameProcessLockLease | null = null;
  let materialized: Awaited<ReturnType<typeof materializeLaunchArguments>> | null = null;
  /** After successful runner.start(), generic pre-spawn cleanup must not run. */
  let processStarted = false;

  const releaseGameLockSafely = async () => {
    if (!gameLease) return;
    const lease = gameLease;
    gameLease = null;
    if (instanceLease) {
      // Already hold InstanceLock — safe exact release without re-acquire.
      try {
        await gameLock.releaseLease(lease);
      } catch {
        // must not clear a newer lease
      }
      return;
    }
    await releaseGameProcessLockCoordinated({
      paths,
      gameLease: lease,
      operationId,
      ...(deps.emitter ? { emitter: deps.emitter } : {})
    });
  };

  const releaseInstanceLock = async () => {
    if (instanceLease) {
      const lease = instanceLease;
      instanceLease = null;
      try {
        await instanceLock.releaseLease(lease);
      } catch {
        // best-effort
      }
    }
  };

  try {
    emitPlayProgress(deps.emitter, operationId, "CHECKING_INSTANCE");
    try {
      instanceLease = await instanceLock.acquire("play", {
        forceStale: req.forceStaleInstanceLock === true,
        owner: `play:${operationId}`
      });
    } catch (e) {
      mapInstanceLockError(e);
    }

    if (deps.hooks?.afterInstanceLockAcquired) {
      await deps.hooks.afterInstanceLockAcquired();
    }

    const readiness = await assertPlayReadiness(req, deps);

    emitPlayProgress(deps.emitter, operationId, "RESOLVING_ACCOUNT");
    throwIfAborted(req.signal);
    const account = await resolvePlayAccount(deps.accounts, req.accountId);

    emitPlayProgress(deps.emitter, operationId, "RESERVING_GAME");
    try {
      gameLease = await gameLock.acquire("play", {
        forceStale: req.forceStaleGameLock === true,
        owner: `play:${operationId}`
      });
    } catch (e) {
      if (
        LauncherError.isLauncherError(e) &&
        (e.code === ErrorCode.GAME_PROCESS_LOCKED ||
          e.code === ErrorCode.GAME_ALREADY_RUNNING ||
          e.code === ErrorCode.GAME_PROCESS_LOCK_INVALID)
      ) {
        if (e.code === ErrorCode.GAME_PROCESS_LOCK_INVALID) throw e;
        throw new LauncherError(ErrorCode.GAME_ALREADY_RUNNING, "game already running", e.details);
      }
      throw e;
    }

    // Handoff complete: mutations will see GameProcessLock after we drop InstanceLock.
    await releaseInstanceLock();

    if (deps.hooks?.afterGameLockReserved) {
      await deps.hooks.afterGameLockReserved();
    }

    throwIfAborted(req.signal);

    emitPlayProgress(deps.emitter, operationId, "RESTORING_SESSION");
    const session = await resolvePlaySession({
      accountId: account.accountId,
      auth: deps.auth,
      ...(deps.sessionCache ? { cache: deps.sessionCache } : {}),
      ...(req.signal ? { signal: req.signal } : {}),
      onPhase: (p) => {
        if (p === "REFRESH") {
          emitPlayProgress(deps.emitter, operationId, "REFRESHING_SESSION");
        } else if (p === "RESTORE") {
          emitPlayProgress(deps.emitter, operationId, "RESTORING_SESSION");
        }
      }
    });

    throwIfAborted(req.signal);
    emitPlayProgress(deps.emitter, operationId, "PREPARING_LAUNCH");

    const productBase = requireConfiguredDistributionOrigin({
      explicit: req.productBase,
      harness: deps.networkHarness,
      runtime: deps.networkRuntime
    });
    const resolved = await resolveLatestRelease({
      channel: req.channel,
      productBase,
      http: deps.http,
      trust: deps.trust,
      antiRollbackState: await deps.antiRollbackStore.load(),
      ...(req.signal ? { signal: req.signal } : {})
    });

    if (
      resolved.release.release.packVersion !== readiness.packVersion ||
      resolved.candidate.releaseSequence !== readiness.releaseSequence
    ) {
      throw new LauncherError(ErrorCode.PLAY_UPDATE_REQUIRED, "trusted tip changed before launch", {
        installedVersion: readiness.packVersion,
        latestVersion: resolved.release.release.packVersion
      });
    }

    const platform = deps.platform ?? detectPlatform();
    const runtimeRoot = req.runtimePath ?? defaultRuntimeRoot();
    const runtimePaths = new RuntimePaths(runtimeRoot);
    const mc = resolved.clientManifest.minecraft;
    const fabric = resolved.clientManifest.fabricLoader;

    if (!deps.runtimeSources) {
      throw new LauncherError(
        ErrorCode.INTERNAL_ERROR,
        "runtimeSources required for play launch plan"
      );
    }

    const plan = await buildRuntimeInstallationPlan({
      minecraftVersion: mc,
      fabricLoaderVersion: fabric,
      platform,
      paths: runtimePaths,
      sources: deps.runtimeSources,
      dryRun: true,
      ...(deps.emitter ? { emitter: deps.emitter } : {})
    });

    let java = deps.java;
    if (!java) {
      if (!plan.javaRequirement) {
        throw new LauncherError(ErrorCode.MISSING_JAVA, "Minecraft metadata missing javaRequirement", {});
      }
      const ensured = await ensureCompatibleJava({
        requirement: plan.javaRequirement,
        runtimeRoot,
        http: deps.http,
        ...(deps.runtimeByteSource ? { byteSource: deps.runtimeByteSource } : {}),
        ...(deps.emitter ? { emitter: deps.emitter } : {}),
        ...(req.signal ? { signal: req.signal } : {}),
        allowProvision: deps.allowManagedJavaProvision !== false,
        skipSystemJava: deps.skipSystemJava === true,
        forceStaleLock: true
      });
      java = ensured.java;
      try {
        await access(java.javaPath, fsConstants.F_OK);
      } catch {
        throw new LauncherError(ErrorCode.MISSING_JAVA, "java executable not accessible", {
          java: path.basename(java.javaPath)
        });
      }
    }

    const runtimeFindings = plan.entries
      .filter((e) => e.action !== "EXTRACT_NATIVE" && e.action !== "WRITE_METADATA")
      .map((e) => ({
        status:
          e.action === "KEEP"
            ? ("OK" as const)
            : e.action === "REPAIR"
              ? ("CORRUPT" as const)
              : e.action === "SKIP"
                ? ("OK" as const)
                : ("MISSING" as const),
        id: e.id,
        relativePath: e.relativePath
      }));

    const maxMemoryMiB = req.memoryMiB ?? 2048;
    const prepared = await prepareLaunch({
      runtime: plan.resolved,
      paths: runtimePaths,
      instanceRoot: paths.root,
      platform,
      java,
      identity: session.launchIdentity,
      memory: {
        maxMemoryMiB,
        ...(req.minMemoryMiB !== undefined ? { minMemoryMiB: req.minMemoryMiB } : {})
      },
      ...(req.extraJvmArgs ? { extraJvmArgs: req.extraJvmArgs } : {}),
      runtimeFindings,
      requireClasspathFiles: deps.requireClasspathFiles !== false,
      allowNotReady: deps.allowIncompleteRuntime === true,
      ...(deps.emitter ? { emitter: deps.emitter } : {})
    });

    if (deps.hooks?.beforeSpawn) {
      await deps.hooks.beforeSpawn();
    }
    throwIfAborted(req.signal);

    emitPlayProgress(deps.emitter, operationId, "STARTING_GAME");
    materialized = await materializeLaunchArguments({
      logicalArgv: prepared.spec.argv,
      ...(prepared.spec.argfilePlan ? { argfilePlan: prepared.spec.argfilePlan } : {})
    });

    const runner = deps.runner;
    if (!runner.start) {
      throw new LauncherError(
        ErrorCode.INTERNAL_ERROR,
        "process runner does not support start(); use Node/Mock runner"
      );
    }

    const startedAtMs = deps.auth.clock.nowMs();
    const ownedGameLease = gameLease;
    if (!ownedGameLease) {
      throw new LauncherError(ErrorCode.INTERNAL_ERROR, "game lease missing after acquire", {});
    }
    let started;
    try {
      started = await runner.start(prepared.spec, {
        secrets: [...prepared.secrets],
        spawnArgv: materialized.spawnArgv,
        ...(deps.emitter ? { emitter: deps.emitter } : {}),
        onSpawned: async (gamePid) => {
          await gameLock.bindGamePid(ownedGameLease, gamePid);
        }
      });
    } catch (e) {
      await materialized.cleanup();
      materialized = null;
      await releaseGameLockSafely();
      if (LauncherError.isLauncherError(e)) throw e;
      throw new LauncherError(ErrorCode.GAME_PROCESS_SPAWN_FAILED, "failed to start Minecraft process", {
        phase: "spawn"
      });
    }

    // ── PROCESS_STARTED boundary ──────────────────────────────────────────
    // Transfer ownership to RunningGame lifecycle BEFORE any post-spawn work
    // so outer catch cannot release an active game's lease / argfile.
    processStarted = true;
    const mat = materialized;
    materialized = null;
    const leaseToRelease = ownedGameLease;
    gameLease = null;

    // lastUsed is bookkeeping only — never fail PLAY or drop game ownership
    try {
      await markAccountLastUsed(deps.accounts, account, deps.auth.clock.nowMs());
    } catch {
      deps.emitter?.emit("PLAY_ACCOUNT_METADATA_WARNING", {
        operationId,
        reason: "last_used_persist_failed"
      });
    }

    emitPlayProgress(deps.emitter, operationId, "RUNNING", {
      gamePid: started.gamePid
    });

    const completion: Promise<GameExitResult> = started.completion.then(async (procResult) => {
      // Cleanup uses all-settled style: one failure must not skip the rest.
      try {
        emitPlayProgress(deps.emitter, operationId, "GAME_EXITED", {
          exitCode: procResult.exitCode
        });
      } catch {
        // ignore
      }
      try {
        emitPlayProgress(deps.emitter, operationId, "CLEANUP");
      } catch {
        // ignore
      }
      if (mat) {
        try {
          await mat.cleanup();
        } catch {
          // still attempt coordinated lock release
        }
      }
      try {
        await releaseGameProcessLockCoordinated({
          paths,
          gameLease: leaseToRelease,
          operationId,
          ...(deps.emitter ? { emitter: deps.emitter } : {})
        });
      } catch {
        // completion must still resolve
      }
      return {
        exitCode: procResult.exitCode,
        signal: procResult.signal,
        durationMs: Math.max(0, deps.auth.clock.nowMs() - startedAtMs),
        kind: procResult.kind
      };
    });

    return {
      operationId,
      gamePid: started.gamePid,
      accountId: account.accountId,
      minecraftUsername: session.profile.name,
      minecraftUuid: session.launchIdentity.uuid,
      packVersion: readiness.packVersion,
      releaseSequence: readiness.releaseSequence,
      startedAt: new Date(startedAtMs).toISOString(),
      completion
    };
  } catch (e) {
    // PRE_SPAWN cleanup only — never drop protection after PROCESS_STARTED
    if (!processStarted) {
      if (materialized) {
        await materialized.cleanup().catch(() => undefined);
      }
      await releaseGameLockSafely();
    }
    await releaseInstanceLock();
    throw e;
  }
}

/** Convenience: start and wait for exit. */
export async function playAndWait(
  req: PlayRequest,
  deps: PlayDependencies
): Promise<PlayResult> {
  const game = await startGame(req, deps);
  const exit = await game.completion;
  return {
    operationId: game.operationId,
    accountId: game.accountId,
    minecraftUsername: game.minecraftUsername,
    minecraftUuid: game.minecraftUuid,
    packVersion: game.packVersion,
    releaseSequence: game.releaseSequence,
    gamePid: game.gamePid,
    outcome: "EXITED",
    exitCode: exit.exitCode,
    signal: exit.signal,
    durationMs: exit.durationMs
  };
}
