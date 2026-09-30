import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { ProgressEmitter } from "../../instance/events/index.js";
import type { LaunchSpec } from "../types.js";
import { sanitizeProcessOutputLine } from "../sanitize.js";

export type GameProcessExitKind = "exit" | "signal" | "spawn_error";

export interface GameProcessResult {
  kind: GameProcessExitKind;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  errorMessage?: string;
  gamePid?: number | null;
}

export interface RunProcessOptions {
  secrets: string[];
  emitter?: ProgressEmitter;
  /** Override spawn argv (e.g. after argfile materialization). Default: spec.argv */
  spawnArgv?: readonly string[];
  /**
   * Called after successful spawn with game PID.
   * If this throws, start() rejects — bind failure is authoritative over early exit.
   */
  onSpawned?: (gamePid: number) => void | Promise<void>;
}

export interface MinecraftProcessRunner {
  run(spec: LaunchSpec, opts: RunProcessOptions): Promise<GameProcessResult>;
  /**
   * Optional: spawn and return before process exit.
   * Used by Play orchestrator RunningGame handle.
   */
  start?(spec: LaunchSpec, opts: RunProcessOptions): Promise<StartedGameProcess>;
}

export interface StartedGameProcess {
  gamePid: number;
  completion: Promise<GameProcessResult>;
}

export interface SpawnAdapter {
  spawn(
    command: string,
    args: readonly string[],
    options: {
      cwd: string;
      env: NodeJS.ProcessEnv;
      shell: false;
    }
  ): ChildProcessWithoutNullStreams;
}

const defaultAdapter: SpawnAdapter = {
  spawn(command, args, options) {
    return spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true
    }) as ChildProcessWithoutNullStreams;
  }
};

type BindState = "pending" | "success" | "failed";

/**
 * Node process runner — always shell:false, argv-based, no exec/execSync.
 *
 * Invariant: start() does not resolve until PID is known AND onSpawned completed
 * successfully. Terminal exit/error during bind is retained, never bypasses bind.
 */
export class NodeMinecraftProcessRunner implements MinecraftProcessRunner {
  constructor(private readonly adapter: SpawnAdapter = defaultAdapter) {}

  async start(spec: LaunchSpec, opts: RunProcessOptions): Promise<StartedGameProcess> {
    return new Promise((resolveStart, rejectStart) => {
      let bindState: BindState = "pending";
      let terminalResult: GameProcessResult | null = null;
      let startSettled = false;
      let completionSettled = false;
      let spawnedPid: number | null = null;

      let resolveCompletion!: (r: GameProcessResult) => void;
      const completion = new Promise<GameProcessResult>((r) => {
        resolveCompletion = r;
      });

      const emitTerminal = (result: GameProcessResult) => {
        if (result.kind === "spawn_error") {
          opts.emitter?.emit("GAME_PROCESS_FAILED", {
            reason: result.kind,
            message: result.errorMessage
              ? sanitizeProcessOutputLine(result.errorMessage, opts.secrets)
              : undefined
          });
        } else {
          opts.emitter?.emit("GAME_PROCESS_EXITED", {
            kind: result.kind,
            exitCode: result.exitCode,
            signal: result.signal
          });
        }
      };

      const finishCompletion = (result: GameProcessResult) => {
        if (completionSettled) return;
        completionSettled = true;
        emitTerminal(result);
        resolveCompletion(result);
      };

      const rejectStartOnce = (err: unknown) => {
        if (startSettled) return;
        startSettled = true;
        rejectStart(err instanceof Error ? err : new Error(String(err)));
      };

      const resolveStartOnce = (gamePid: number) => {
        if (startSettled) return;
        startSettled = true;
        resolveStart({ gamePid, completion });
      };

      /** Capture first terminal event; do not settle start while bind is pending. */
      const captureTerminal = (result: GameProcessResult) => {
        if (terminalResult !== null) return;
        terminalResult = result;

        if (bindState === "pending") {
          return;
        }
        if (bindState === "failed") {
          // start already rejected; still settle completion exactly once if needed
          finishCompletion(result);
          return;
        }
        // bind success — start already resolved (or about to); complete now
        finishCompletion(result);
      };

      const argv = opts.spawnArgv ?? spec.argv;
      let child: ChildProcessWithoutNullStreams;
      try {
        const env: NodeJS.ProcessEnv = { ...process.env, ...spec.environment };
        child = this.adapter.spawn(spec.javaExecutable, argv, {
          cwd: spec.workingDirectory,
          env,
          shell: false
        });
      } catch (e) {
        bindState = "failed";
        const result: GameProcessResult = {
          kind: "spawn_error",
          exitCode: null,
          signal: null,
          errorMessage: e instanceof Error ? e.message : String(e),
          gamePid: null
        };
        terminalResult = result;
        rejectStartOnce(new Error(result.errorMessage ?? "spawn failed"));
        finishCompletion(result);
        return;
      }

      spawnedPid = child.pid ?? null;
      // Low-level spawn notification only — NOT authoritative PLAY RUNNING.
      // PLAY_PROGRESS phase RUNNING is emitted only after start() resolves
      // (PID known AND onSpawned/bind succeeded).
      opts.emitter?.emit("GAME_PROCESS_STARTED", {
        pid: spawnedPid,
        javaExecutable: spec.javaExecutable,
        argvCount: argv.length,
        cwd: spec.workingDirectory
      });

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        opts.emitter?.emit("GAME_STDOUT", {
          line: sanitizeProcessOutputLine(String(chunk), opts.secrets)
        });
      });
      child.stderr.on("data", (chunk: string) => {
        opts.emitter?.emit("GAME_STDERR", {
          line: sanitizeProcessOutputLine(String(chunk), opts.secrets)
        });
      });
      child.on("error", (err) => {
        captureTerminal({
          kind: "spawn_error",
          exitCode: null,
          signal: null,
          errorMessage: err.message,
          gamePid: spawnedPid
        });
      });
      child.on("exit", (code, signal) => {
        if (signal) {
          captureTerminal({ kind: "signal", exitCode: code, signal, gamePid: spawnedPid });
          return;
        }
        captureTerminal({ kind: "exit", exitCode: code, signal: null, gamePid: spawnedPid });
      });

      void (async () => {
        if (spawnedPid === null) {
          bindState = "failed";
          const result: GameProcessResult = {
            kind: "spawn_error",
            exitCode: null,
            signal: null,
            errorMessage: "spawn produced no pid",
            gamePid: null
          };
          if (terminalResult === null) terminalResult = result;
          rejectStartOnce(new Error(result.errorMessage!));
          finishCompletion(terminalResult ?? result);
          return;
        }

        try {
          if (opts.onSpawned) {
            await opts.onSpawned(spawnedPid);
          }
          bindState = "success";
        } catch (e) {
          bindState = "failed";
          try {
            child.kill();
          } catch {
            // best-effort — process may already have exited
          }
          const bindErr = e instanceof Error ? e : new Error(String(e));
          const result: GameProcessResult = {
            kind: "spawn_error",
            exitCode: null,
            signal: null,
            errorMessage: bindErr.message,
            gamePid: spawnedPid
          };
          // Bind failure is authoritative for start — do not surface early exit as STARTED
          rejectStartOnce(bindErr);
          finishCompletion(result);
          return;
        }

        // Child "error" before/during bind with successful bind: still fail start.
        // (Event handlers may have assigned terminalResult during await onSpawned.)
        const earlyTerminal = terminalResult as GameProcessResult | null;
        if (earlyTerminal?.kind === "spawn_error") {
          rejectStartOnce(new Error(earlyTerminal.errorMessage ?? "spawn failed"));
          finishCompletion(earlyTerminal);
          return;
        }

        resolveStartOnce(spawnedPid);
        if (earlyTerminal !== null) {
          finishCompletion(earlyTerminal);
        }
      })();
    });
  }

  run(spec: LaunchSpec, opts: RunProcessOptions): Promise<GameProcessResult> {
    return this.start(spec, opts).then(
      (s) => s.completion,
      (e) =>
        Promise.resolve({
          kind: "spawn_error" as const,
          exitCode: null,
          signal: null,
          errorMessage: e instanceof Error ? e.message : String(e),
          gamePid: null
        })
    );
  }
}

/**
 * Hermetic mock runner for tests — records spawn, never starts Minecraft.
 */
export class MockMinecraftProcessRunner implements MinecraftProcessRunner {
  lastSpec: LaunchSpec | null = null;
  lastSpawnArgv: readonly string[] | null = null;
  lastShell: false | null = null;
  spawnCount = 0;
  /** Simulate error then exit both firing — only first settlement counts via real runner; mock tests single path. */
  alsoEmitExitAfterError = false;
  behavior: {
    kind: GameProcessExitKind;
    exitCode?: number | null;
    signal?: NodeJS.Signals | null;
    stdout?: string;
    stderr?: string;
    throwOnSpawn?: boolean;
    gamePid?: number;
    bindThrows?: boolean;
    /** When true, completion waits until releaseDeferredExit(). */
    deferExit?: boolean;
  } = { kind: "exit", exitCode: 0 };

  private deferredRelease: (() => void) | null = null;

  /** Unblock a deferred exit (tests). */
  releaseDeferredExit(): void {
    this.deferredRelease?.();
    this.deferredRelease = null;
  }

  async start(spec: LaunchSpec, opts: RunProcessOptions): Promise<StartedGameProcess> {
    this.spawnCount += 1;
    this.lastSpec = spec;
    this.lastSpawnArgv = opts.spawnArgv ?? spec.argv;
    this.lastShell = false;

    if (this.behavior.throwOnSpawn) {
      opts.emitter?.emit("GAME_PROCESS_FAILED", {
        reason: "spawn_error",
        message: "mock spawn failed"
      });
      throw new Error("mock spawn failed");
    }

    const gamePid = this.behavior.gamePid ?? 4242;
    opts.emitter?.emit("GAME_PROCESS_STARTED", {
      pid: gamePid,
      javaExecutable: spec.javaExecutable,
      argvCount: (opts.spawnArgv ?? spec.argv).length,
      cwd: spec.workingDirectory
    });

    if (opts.onSpawned) {
      if (this.behavior.bindThrows) {
        try {
          await opts.onSpawned(gamePid);
        } catch (e) {
          opts.emitter?.emit("GAME_PROCESS_FAILED", {
            reason: "spawn_error",
            message: e instanceof Error ? e.message : String(e)
          });
          throw e instanceof Error ? e : new Error(String(e));
        }
      } else {
        await opts.onSpawned(gamePid);
      }
    }

    if (this.behavior.stdout) {
      opts.emitter?.emit("GAME_STDOUT", {
        line: sanitizeProcessOutputLine(this.behavior.stdout, opts.secrets)
      });
    }
    if (this.behavior.stderr) {
      opts.emitter?.emit("GAME_STDERR", {
        line: sanitizeProcessOutputLine(this.behavior.stderr, opts.secrets)
      });
    }

    const finish = async (): Promise<GameProcessResult> => {
      if (this.behavior.deferExit) {
        await new Promise<void>((r) => {
          this.deferredRelease = r;
        });
      }
      if (this.behavior.kind === "spawn_error") {
        opts.emitter?.emit("GAME_PROCESS_FAILED", {
          reason: "spawn_error",
          message: "mock mid error"
        });
        return {
          kind: "spawn_error",
          exitCode: null,
          signal: null,
          errorMessage: "mock mid error",
          gamePid
        };
      }
      if (this.behavior.kind === "signal") {
        const signal = this.behavior.signal ?? "SIGTERM";
        opts.emitter?.emit("GAME_PROCESS_EXITED", { kind: "signal", signal, exitCode: null });
        return { kind: "signal", exitCode: null, signal, gamePid };
      }
      const exitCode = this.behavior.exitCode ?? 0;
      opts.emitter?.emit("GAME_PROCESS_EXITED", { kind: "exit", exitCode, signal: null });
      return { kind: "exit", exitCode, signal: null, gamePid };
    };

    return { gamePid, completion: finish() };
  }

  async run(spec: LaunchSpec, opts: RunProcessOptions): Promise<GameProcessResult> {
    try {
      const started = await this.start(spec, opts);
      return await started.completion;
    } catch (e) {
      return {
        kind: "spawn_error",
        exitCode: null,
        signal: null,
        errorMessage: e instanceof Error ? e.message : String(e),
        gamePid: null
      };
    }
  }
}
