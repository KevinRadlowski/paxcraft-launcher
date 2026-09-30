import { ErrorCode, LauncherError } from "../core/errors/index.js";

export interface LaunchMemoryOptions {
  /** -Xms in MiB (optional). */
  minMemoryMiB?: number;
  /** -Xmx in MiB (required for controlled memory). */
  maxMemoryMiB: number;
}

export interface MemoryValidationOptions {
  /** Hard ceiling for -Xmx (default 32768 MiB). */
  maxAllowedMiB?: number;
  /** Floor for -Xms/-Xmx (default 256). */
  minAllowedMiB?: number;
}

export function validateLaunchMemory(
  opts: LaunchMemoryOptions,
  limits: MemoryValidationOptions = {}
): LaunchMemoryOptions {
  const maxAllowed = limits.maxAllowedMiB ?? 32768;
  const minAllowed = limits.minAllowedMiB ?? 256;

  const max = assertMemoryMiB(opts.maxMemoryMiB, "maxMemoryMiB", minAllowed, maxAllowed);
  let min: number | undefined;
  if (opts.minMemoryMiB !== undefined) {
    min = assertMemoryMiB(opts.minMemoryMiB, "minMemoryMiB", minAllowed, maxAllowed);
    if (min > max) {
      throw new LauncherError(ErrorCode.INVALID_LAUNCH_MEMORY, "minMemoryMiB > maxMemoryMiB", {
        min,
        max
      });
    }
  }
  return min !== undefined ? { minMemoryMiB: min, maxMemoryMiB: max } : { maxMemoryMiB: max };
}

function assertMemoryMiB(value: unknown, field: string, minAllowed: number, maxAllowed: number): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < minAllowed ||
    value > maxAllowed
  ) {
    throw new LauncherError(ErrorCode.INVALID_LAUNCH_MEMORY, `invalid ${field}`, {
      field,
      value,
      minAllowed,
      maxAllowed
    });
  }
  return value;
}

/** Launcher-controlled memory JVM args (always applied; strip metadata Xmx/Xms). */
export function memoryJvmArgs(opts: LaunchMemoryOptions): string[] {
  const out: string[] = [];
  if (opts.minMemoryMiB !== undefined) {
    out.push(`-Xms${opts.minMemoryMiB}M`);
  }
  out.push(`-Xmx${opts.maxMemoryMiB}M`);
  return out;
}

/** True if arg is a memory heap flag we control (-Xms / -Xmx). */
export function isHeapMemoryJvmArg(arg: string): boolean {
  return /^-Xm[sx]/i.test(arg);
}
