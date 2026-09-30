/**
 * Semantic storage open for Settings (0.6F.4) + PACK-10.1G configurable instance path.
 * Resolves SweetCraft instance/logs paths — never accepts renderer paths.
 */

import fs from "node:fs";
import path from "node:path";
import type { StorageOpenResultDto, StorageSummaryDto } from "../../shared/contract.js";
import { resolveDesktopInstancePaths } from "../../shared/instance-paths.js";

export type StorageOpenTarget = "instance" | "logs";

export interface SweetCraftStoragePaths {
  readonly dataDir: string;
  readonly instancePath: string;
  readonly logsPath: string;
  readonly isConfigured: boolean;
  readonly locationUnavailable: boolean;
}

/** Resolve authoritative instance paths from userData + optional configured path. */
export function resolveSweetCraftStoragePaths(
  userData: string,
  configuredInstancePath?: string | null
): SweetCraftStoragePaths {
  const resolved = resolveDesktopInstancePaths(userData, configuredInstancePath);
  return {
    dataDir: resolved.dataDir,
    instancePath: resolved.instancePath,
    logsPath: resolved.logsPath,
    isConfigured: resolved.isConfigured,
    locationUnavailable: resolved.locationUnavailable
  };
}

export function getStorageSummary(
  userData: string,
  configuredInstancePath?: string | null
): StorageSummaryDto {
  const { instancePath, logsPath, isConfigured, locationUnavailable } = resolveSweetCraftStoragePaths(
    userData,
    configuredInstancePath
  );
  const launcherDataDir = path.join(userData, "launcher-data");
  const launcherDataAvailable = fs.existsSync(launcherDataDir);
  const instanceAvailable = !locationUnavailable && fs.existsSync(instancePath);
  const logsAvailable = instanceAvailable || fs.existsSync(logsPath);
  return {
    instanceAvailable,
    logsAvailable,
    launcherDataAvailable,
    instanceLocationConfigured: isConfigured,
    instanceLocationAvailable: !locationUnavailable,
    instancePath
  };
}

export interface OpenStorageOptions {
  readonly userData: string;
  readonly configuredInstancePath?: string | null;
  readonly target: StorageOpenTarget;
  /** Electron shell.openPath — returns empty string on success. */
  readonly openPath: (absolutePath: string) => Promise<string>;
  /** Create logs dir when opening logs (product-appropriate). */
  readonly ensureLogsDir?: boolean;
}

/**
 * Open instance or logs only. Rejects any other target at the type level.
 * Never opens userData root or credential stores.
 */
export async function openStorageTarget(opts: OpenStorageOptions): Promise<StorageOpenResultDto> {
  const { instancePath, logsPath, locationUnavailable } = resolveSweetCraftStoragePaths(
    opts.userData,
    opts.configuredInstancePath
  );
  const ensureLogs = opts.ensureLogsDir !== false;

  if (locationUnavailable) {
    return { opened: false, target: opts.target, unavailable: true };
  }

  if (opts.target === "instance") {
    if (!fs.existsSync(instancePath)) {
      return { opened: false, target: "instance", unavailable: true };
    }
    const err = await opts.openPath(instancePath);
    return { opened: !err, target: "instance", ...(err ? { unavailable: true } : {}) };
  }

  if (!fs.existsSync(instancePath) && !fs.existsSync(logsPath)) {
    return { opened: false, target: "logs", unavailable: true };
  }
  if (ensureLogs) {
    try {
      fs.mkdirSync(logsPath, { recursive: true });
    } catch {
      return { opened: false, target: "logs", unavailable: true };
    }
  } else if (!fs.existsSync(logsPath)) {
    return { opened: false, target: "logs", unavailable: true };
  }
  const err = await opts.openPath(logsPath);
  return { opened: !err, target: "logs", ...(err ? { unavailable: true } : {}) };
}

/** Keys that must never appear on storage DTOs returned to the renderer. */
export const STORAGE_DTO_FORBIDDEN_KEYS = [
  "path",
  "absolutePath",
  "logsPath",
  "dataDir",
  "userData",
  "homedir",
  "username"
] as const;
