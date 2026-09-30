/**
 * Real frozen 0.5B adapter.
 * Calls startGame() exactly once per start(); adapts RunningGame.completion.
 * coldRestorePlaySession remains AUTH-only — process observation uses GameProcessLock.inspect.
 */

import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PlayStatusDto } from "../../shared/contract.js";
import { normalizePlayStatus } from "./play-dto.js";
import { mapPlayError } from "./play-errors.js";
import type { PlayBackendPort, PlayBackendStartResult } from "./play-types.js";
import { buildPlayContext, type BuiltPlayContext } from "./play-deps-builder.js";
import { PRODUCT_DEFAULT_CHANNEL } from "../../shared/product.js";

export interface RealPlayBackendOptions {
  dataDir: string;
  getInstancePath: () => string;
  runtimePath?: string;
  distRoot: string;
  channel?: "dev" | "beta" | "stable";
  productBase?: string;
  trustedKeysPath?: string;
  memoryMiB?: number;
  /** Read memory at each start — applied to NEXT launch only. */
  getMemoryMiB?: () => number | undefined;
  /** Poll interval for ACTIVE lock without attached completion (ms). Bounded ≥1000. */
  observePollMs?: number;
  /** Test injection: frozen startGame override (must not spawn Minecraft in tests). */
  startGameOverride?: BuiltPlayContext["startGame"];
  /** Test injection: process runner. */
  runner?: unknown;
  /** Shared PlaySessionCache across starts. */
  sessionCache?: unknown;
  /** Test-only: bypass network inspectInstanceStatus preflight. */
  assertReadyOverride?: () => Promise<void>;
}

type LockModule = {
  GameProcessLock: new (paths: unknown) => {
    inspect(): Promise<"ABSENT" | "ACTIVE" | "STALE" | "MALFORMED">;
  };
  InstancePaths: new (instancePath: string) => unknown;
};

async function loadLockModule(distRoot: string): Promise<LockModule> {
  const lockHref = pathToFileURL(path.join(distRoot, "launch", "process", "lock.js")).href;
  const pathsHref = pathToFileURL(path.join(distRoot, "instance", "layout", "index.js")).href;
  const [lock, layout] = await Promise.all([import(lockHref), import(pathsHref)]);
  return {
    GameProcessLock: lock.GameProcessLock,
    InstancePaths: layout.InstancePaths
  };
}

const PHASE_KEY: Record<string, string> = {
  CHECKING_INSTANCE: "play.phase.preparing",
  RESOLVING_ACCOUNT: "play.phase.preparing",
  RESTORING_SESSION: "play.phase.preparing",
  REFRESHING_SESSION: "play.phase.preparing",
  CHECKING_JAVA: "play.phase.checking_java",
  RESOLVING_JAVA_PROVIDER: "play.phase.resolving_java",
  DOWNLOADING_JAVA: "play.phase.downloading_java",
  VERIFYING_JAVA: "play.phase.verifying_java",
  EXTRACTING_JAVA: "play.phase.extracting_java",
  INSTALLING_JAVA: "play.phase.installing_java",
  JAVA_READY: "play.phase.preparing",
  PREPARING_LAUNCH: "play.phase.preparing",
  RESERVING_GAME: "play.phase.launching",
  STARTING_GAME: "play.phase.launching",
  RUNNING: "play.phase.running"
};

export async function createRealPlayBackend(
  opts: RealPlayBackendOptions
): Promise<PlayBackendPort & { dispose(): void; getStartGameCallCount(): number }> {
  const lockMod = await loadLockModule(opts.distRoot);
  let cachedLockPath = "";
  let paths = new lockMod.InstancePaths(opts.getInstancePath());
  let gameLock = new lockMod.GameProcessLock(paths);

  function refreshLockIfNeeded(): void {
    const current = opts.getInstancePath();
    if (current === cachedLockPath) return;
    cachedLockPath = current;
    paths = new lockMod.InstancePaths(current);
    gameLock = new lockMod.GameProcessLock(paths);
    ctx = null;
  }

  let observeTimer: ReturnType<typeof setInterval> | null = null;
  let startGameCalls = 0;
  let ctx: BuiltPlayContext | null = null;

  const pollMs = Math.max(1000, opts.observePollMs ?? 2000);

  function stopObserve(): void {
    if (observeTimer) {
      clearInterval(observeTimer);
      observeTimer = null;
    }
  }

  function startObservationalPoll(
    onStatus?: (s: PlayStatusDto) => void
  ): Promise<{ exitCode: number | null }> {
    stopObserve();
    return new Promise((resolve) => {
      observeTimer = setInterval(() => {
        void (async () => {
          try {
            const st = await gameLock.inspect();
            if (st === "MALFORMED") {
              stopObserve();
              onStatus?.(
                normalizePlayStatus({
                  state: "RECOVERY_REQUIRED",
                  messageKey: "error.play.malformed_lock"
                })
              );
              resolve({ exitCode: null });
              return;
            }
            if (st !== "ACTIVE") {
              // ABSENT or STALE — observational only; never mutate lock.
              stopObserve();
              onStatus?.(
                normalizePlayStatus({
                  state: "EXITED",
                  lastExitCode: null,
                  messageKey: "play.message.exited"
                })
              );
              resolve({ exitCode: null });
            }
          } catch {
            // keep polling
          }
        })();
      }, pollMs);
    });
  }

  async function ensureCtx(onPhase?: (phase: string) => void): Promise<BuiltPlayContext> {
    refreshLockIfNeeded();
    if (ctx && !onPhase) return ctx;
    ctx = await buildPlayContext({
      distRoot: opts.distRoot,
      dataDir: opts.dataDir,
      instancePath: opts.getInstancePath(),
      ...(opts.runtimePath ? { runtimePath: opts.runtimePath } : {}),
      channel: opts.channel ?? PRODUCT_DEFAULT_CHANNEL,
      ...(opts.productBase ? { productBase: opts.productBase } : {}),
      ...(opts.trustedKeysPath ? { trustedKeysPath: opts.trustedKeysPath } : {}),
      ...(opts.getMemoryMiB ? { getMemoryMiB: opts.getMemoryMiB } : {}),
      ...(opts.memoryMiB !== undefined ? { memoryMiB: opts.memoryMiB } : {}),
      ...(opts.startGameOverride ? { startGameOverride: opts.startGameOverride } : {}),
      ...(opts.runner ? { runner: opts.runner } : {}),
      ...(opts.sessionCache ? { sessionCache: opts.sessionCache } : {}),
      ...(onPhase ? { onPlayPhase: onPhase } : {})
    });
    return ctx;
  }

  async function inspectStatus(): Promise<PlayStatusDto> {
    try {
      const st = await gameLock.inspect();
      if (st === "ACTIVE") {
        return normalizePlayStatus({
          state: "RUNNING",
          phaseKey: "play.phase.running",
          messageKey: "play.message.running"
        });
      }
      if (st === "MALFORMED") {
        return normalizePlayStatus({
          state: "RECOVERY_REQUIRED",
          messageKey: "error.play.malformed_lock"
        });
      }
      return normalizePlayStatus({ state: "UNAVAILABLE" });
    } catch (e) {
      throw mapPlayError(e);
    }
  }

  return {
    getStartGameCallCount: () => startGameCalls,
    dispose: () => stopObserve(),

    async getStatus(): Promise<PlayStatusDto> {
      return inspectStatus();
    },

    async restoreObservedSession(): Promise<PlayStatusDto> {
      const status = await inspectStatus();
      if (status.state === "RUNNING") {
        void startObservationalPoll();
      }
      return status;
    },

    async start(startOpts: {
      accountId: string;
      onStatus?: (s: PlayStatusDto) => void;
    }): Promise<PlayBackendStartResult> {
      try {
        const onPhase = (phase: string) => {
          const key = PHASE_KEY[phase] ?? "play.phase.preparing";
          startOpts.onStatus?.(
            normalizePlayStatus({
              state: phase === "RUNNING" ? "RUNNING" : "LAUNCHING",
              accountId: startOpts.accountId,
              phaseKey: key,
              messageKey:
                phase === "RUNNING" ? "play.message.running" : "play.message.launching"
            })
          );
        };

        const built = await ensureCtx(onPhase);

        // Authoritative 0.5A READY — renderer READY is not sufficient.
        if (opts.assertReadyOverride) {
          await opts.assertReadyOverride();
        } else {
          await built.assertAuthoritativeReady();
        }

        const req = built.buildRequest(startOpts.accountId);
        const deps = await built.buildDependencies();

        startGameCalls += 1;
        const game = await built.startGame(req, deps);

        const running = normalizePlayStatus({
          state: "RUNNING",
          accountId: game.accountId,
          minecraftUsername: game.minecraftUsername,
          phaseKey: "play.phase.running",
          messageKey: "play.message.running"
        });
        startOpts.onStatus?.(running);

        const completion = game.completion.then((exit) => ({
          exitCode: exit.exitCode
        }));

        return { status: running, completion };
      } catch (e) {
        throw mapPlayError(e);
      }
    }
  };
}
