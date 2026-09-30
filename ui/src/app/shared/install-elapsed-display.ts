import type { InstallActiveOperation } from '@sweetcraft/ipc';

/** Hide elapsed label for very fast operations. */
export const INSTALL_ELAPSED_HIDE_MS = 1000;

export function isInstallOperationActive(activeOperation: InstallActiveOperation): boolean {
  return activeOperation !== 'IDLE';
}

/** Whole-operation elapsed from authoritative renderer start timestamp. */
export function computeOperationElapsedMs(
  operationStartedAt: number | null,
  nowMs: number,
): number | undefined {
  if (operationStartedAt === null || !Number.isFinite(operationStartedAt)) return undefined;
  return Math.max(0, nowMs - operationStartedAt);
}

/**
 * Display elapsed for active install/check mutations.
 * Prefers renderer clock (ticks between backend events); backend snapshot is fallback only.
 */
export function resolveInstallDisplayElapsedMs(args: {
  operationStartedAt: number | null;
  nowMs: number;
  activeOperation: InstallActiveOperation;
  backendElapsedMs?: number;
}): number | undefined {
  if (!isInstallOperationActive(args.activeOperation)) return undefined;
  const local = computeOperationElapsedMs(args.operationStartedAt, args.nowMs);
  if (local !== undefined) return local;
  if (args.backendElapsedMs !== undefined && args.backendElapsedMs >= 0) {
    return args.backendElapsedMs;
  }
  return undefined;
}

export function shouldShowInstallElapsed(elapsedMs: number | undefined): boolean {
  return elapsedMs !== undefined && elapsedMs >= INSTALL_ELAPSED_HIDE_MS;
}

/** Testable 1 Hz ticker — one interval max, stopped when operation idle. */
export function createInstallElapsedTickerController(opts: {
  isActive: () => boolean;
  onTick: () => void;
  intervalMs?: number;
  setIntervalFn?: (handler: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearIntervalFn?: (id: ReturnType<typeof setInterval>) => void;
}): { sync(): void; dispose(): void; isRunning(): boolean } {
  const intervalMs = opts.intervalMs ?? 1000;
  const setIntervalFn = opts.setIntervalFn ?? setInterval;
  const clearIntervalFn = opts.clearIntervalFn ?? clearInterval;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  function stop(): void {
    if (intervalId !== null) {
      clearIntervalFn(intervalId);
      intervalId = null;
    }
  }

  return {
    sync() {
      if (opts.isActive()) {
        if (intervalId === null) {
          intervalId = setIntervalFn(() => opts.onTick(), intervalMs);
        }
      } else {
        stop();
      }
    },
    dispose() {
      stop();
    },
    isRunning() {
      return intervalId !== null;
    },
  };
}
