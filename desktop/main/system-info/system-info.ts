/**
 * Safe system snapshot for Settings (0.6F.4).
 * Collects via node:os only. Never hostname, username, env, GPU, or paths.
 *
 * Disk totals are always null here — multi-disk inventory is a separate IPC
 * (`sc:system:getFixedDisks` / listFixedDisks). Do not call PowerShell or
 * fs.statfs from this hot path.
 */

import os from "node:os";
import type { SystemInfoDto } from "../../shared/contract.js";
import { DESKTOP_PRODUCT_VERSION } from "../../shared/product.js";
import {
  SETTINGS_MEMORY_DEFAULT_MIB,
  SETTINGS_MEMORY_MAX_MIB,
  SETTINGS_MEMORY_MIN_MIB
} from "../settings/settings-store.js";

const MEMORY_STEP = 512;
const RECOMMEND_CAP_MIB = 8192;
const RECOMMEND_FLOOR_MIB = SETTINGS_MEMORY_DEFAULT_MIB;
const RECOMMEND_FRACTION = 0.35;

/**
 * Advisory Minecraft heap recommendation from total system RAM.
 * Formula: min(8192, max(2048, floor((total*0.35)/512)*512)) then clamp to [512, 32768].
 * Never auto-overwrites user settings — UI advisory only.
 */
export function recommendMemoryMiB(totalMemoryMiB: number | null | undefined): number | null {
  if (
    typeof totalMemoryMiB !== "number" ||
    !Number.isFinite(totalMemoryMiB) ||
    totalMemoryMiB <= 0
  ) {
    return null;
  }
  const raw = Math.floor((totalMemoryMiB * RECOMMEND_FRACTION) / MEMORY_STEP) * MEMORY_STEP;
  const capped = Math.min(RECOMMEND_CAP_MIB, Math.max(RECOMMEND_FLOOR_MIB, raw));
  return Math.min(SETTINGS_MEMORY_MAX_MIB, Math.max(SETTINGS_MEMORY_MIN_MIB, capped));
}

function bytesToMiB(bytes: number): number {
  return Math.max(0, Math.floor(bytes / (1024 * 1024)));
}

/** Human OS label without hostname/username. */
export function buildOsLabel(platform: NodeJS.Platform, release: string): string | null {
  if (platform === "win32") {
    // Windows 10+ share NT 10.0 kernel numbering; avoid claiming a precise SKU.
    return "Windows 10+";
  }
  if (platform === "darwin") {
    return release ? `macOS (${release})` : "macOS";
  }
  if (platform === "linux") {
    return release ? `Linux (${release})` : "Linux";
  }
  return platform || null;
}

export interface CollectSystemInfoOptions {
  readonly launcherVersion?: string;
  /**
   * @deprecated Ignored — disk probe removed from getInfo hot path.
   * Use `listFixedDisks` / SYSTEM_GET_FIXED_DISKS instead.
   */
  readonly diskProbePath?: string | null;
  readonly nowMs?: number;
  /** Injectable for tests */
  readonly osApi?: {
    platform(): NodeJS.Platform;
    arch(): string;
    release(): string;
    cpus(): readonly { model: string }[];
    totalmem(): number;
    freemem(): number;
  };
}

/**
 * Collect a renderer-safe system info DTO.
 * Failures degrade to available:false with null metrics — never throw secrets.
 * diskTotalGiB / diskFreeGiB are always null (multi-disk IPC is separate).
 */
export async function collectSystemInfo(
  opts: CollectSystemInfoOptions = {}
): Promise<SystemInfoDto> {
  const checkedAtMs = opts.nowMs ?? Date.now();
  const launcherVersion = opts.launcherVersion ?? DESKTOP_PRODUCT_VERSION;
  const unavailable = (): SystemInfoDto => ({
    available: false,
    platform: "unknown",
    arch: "unknown",
    osLabel: null,
    cpuModel: null,
    cpuCount: null,
    totalMemoryMiB: null,
    freeMemoryMiB: null,
    diskTotalGiB: null,
    diskFreeGiB: null,
    launcherVersion,
    checkedAtMs,
    recommendedMemoryMiB: null
  });

  try {
    const api = opts.osApi ?? os;
    const platform = api.platform();
    const arch = api.arch();
    const release = api.release();
    const cpus = api.cpus();
    const cpuModel =
      Array.isArray(cpus) && cpus.length > 0 && typeof cpus[0]?.model === "string"
        ? cpus[0].model.trim().slice(0, 128) || null
        : null;
    const cpuCount = Array.isArray(cpus) && cpus.length > 0 ? cpus.length : null;
    const totalMemoryMiB = bytesToMiB(api.totalmem());
    const freeMemoryMiB = bytesToMiB(api.freemem());

    return {
      available: true,
      platform: String(platform),
      arch: String(arch),
      osLabel: buildOsLabel(platform, release),
      cpuModel,
      cpuCount,
      totalMemoryMiB,
      freeMemoryMiB,
      // Legacy optional fields kept null — multi-disk via getFixedDisks.
      diskTotalGiB: null,
      diskFreeGiB: null,
      launcherVersion,
      checkedAtMs,
      recommendedMemoryMiB: recommendMemoryMiB(totalMemoryMiB)
    };
  } catch {
    return unavailable();
  }
}

/** Forbidden keys that must never appear on SystemInfoDto / JSON snapshots. */
export const SYSTEM_INFO_FORBIDDEN_KEYS = [
  "hostname",
  "username",
  "homedir",
  "tmpdir",
  "userInfo",
  "env",
  "path",
  "absolutePath",
  "instancePath",
  "userData",
  "gpu",
  "directx"
] as const;
