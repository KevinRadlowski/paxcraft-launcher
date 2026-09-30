/**
 * Fixed (local) disk inventory for Settings (0.6F.4 V3).
 * Windows: static PowerShell CIM query — NEVER accepts renderer args.
 * Multi-disk is a separate IPC from system getInfo (which no longer probes disk).
 */

import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import type { FixedDiskDto, FixedDiskInventoryDto } from "../../shared/contract.js";
import { resolveSweetCraftStoragePaths } from "../storage/storage-actions.js";

const execFileAsync = promisify(nodeExecFile);

/** Immutable PowerShell exe — never from renderer. */
export const FIXED_DISK_PS_EXE = "powershell.exe";

/**
 * Static argv only — never concatenate user/renderer input.
 * DriveType=3 = local fixed disks.
 */
export const FIXED_DISK_PS_ARGS = [
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID, Size, FreeSpace | ConvertTo-Json -Compress'
] as const;

/** Keys that must never appear on FixedDisk DTO / JSON snapshots. */
export const FIXED_DISK_FORBIDDEN_KEYS = [
  "serial",
  "uuid",
  "path",
  "absolutePath",
  "volumeName",
  "label",
  "DeviceID",
  "hostname",
  "username",
  "userData",
  "instancePath",
  "stderr",
  "stdout",
  "command",
  "psCommand"
] as const;

export type FixedDiskExecFile = (
  file: string,
  args: readonly string[],
  options: {
    shell: false;
    windowsHide: true;
    timeout: number;
    maxBuffer: number;
    encoding: "utf8";
  }
) => Promise<{ stdout: string; stderr: string }>;

export interface ListFixedDisksOptions {
  /** Electron userData — used only to mark SweetCraft drive letter (no dirs created). */
  readonly userData: string;
  /** PACK-10.1G — configured instance path for drive letter marking. */
  readonly instancePath?: string;
  readonly platform?: NodeJS.Platform;
  readonly nowMs?: number;
  /** Injectable for tests — defaults to child_process.execFile. */
  readonly execFile?: FixedDiskExecFile;
}

function emptyInventory(checkedAtMs: number): FixedDiskInventoryDto {
  return { available: false, disks: [], checkedAtMs };
}

/** Extract drive letter from an absolute Windows path (e.g. H:\\foo → "H:"). */
export function driveLetterFromPath(absPath: string): string | null {
  const m = /^([A-Za-z]):/.exec(absPath);
  return m ? `${m[1]!.toUpperCase()}:` : null;
}

function bytesToGiBRounded(bytes: number): number {
  return Math.round((bytes / 1024 ** 3) * 10) / 10;
}

function usedPercent(total: number, free: number): number {
  if (!(total > 0) || !Number.isFinite(total) || !Number.isFinite(free)) return 0;
  const pct = Math.round(((total - free) / total) * 100);
  return Math.min(100, Math.max(0, pct));
}

function normalizeDeviceId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = /^([A-Za-z]):\s*$/.exec(raw.trim());
  return m ? `${m[1]!.toUpperCase()}:` : null;
}

interface RawCimDisk {
  DeviceID?: unknown;
  Size?: unknown;
  FreeSpace?: unknown;
}

/**
 * Parse ConvertTo-Json output from the static CIM query.
 * Skips zero/malformed sizes. DriveType already filtered in the script.
 */
export function parseFixedDisksJson(
  stdout: string,
  sweetCraftDriveLetter: string | null
): FixedDiskDto[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }

  const rows: RawCimDisk[] = Array.isArray(parsed)
    ? (parsed as RawCimDisk[])
    : parsed && typeof parsed === "object"
      ? [parsed as RawCimDisk]
      : [];

  const disks: FixedDiskDto[] = [];
  for (const row of rows) {
    const drive = normalizeDeviceId(row.DeviceID);
    if (!drive) continue;
    const size = Number(row.Size);
    const free = Number(row.FreeSpace);
    if (!Number.isFinite(size) || size <= 0) continue;
    if (!Number.isFinite(free) || free < 0) continue;
    const totalGiB = bytesToGiBRounded(size);
    const freeGiB = bytesToGiBRounded(free);
    disks.push({
      drive,
      totalGiB,
      freeGiB,
      usedPercent: usedPercent(size, free),
      isSweetCraftDrive: sweetCraftDriveLetter !== null && drive === sweetCraftDriveLetter
    });
  }
  return disks;
}

/**
 * List fixed local disks. Failures → available:false, disks:[] — never raw stderr to UI.
 * Does not create directories. Does not accept renderer path/args.
 */
export async function listFixedDisks(
  opts: ListFixedDisksOptions
): Promise<FixedDiskInventoryDto> {
  const checkedAtMs = opts.nowMs ?? Date.now();
  const platform = opts.platform ?? process.platform;
  if (platform !== "win32") {
    return emptyInventory(checkedAtMs);
  }

  let sweetCraftDriveLetter: string | null = null;
  try {
    const instancePath =
      opts.instancePath ??
      resolveSweetCraftStoragePaths(opts.userData).instancePath;
    sweetCraftDriveLetter = driveLetterFromPath(instancePath);
  } catch {
    sweetCraftDriveLetter = null;
  }

  const run = opts.execFile ?? (execFileAsync as FixedDiskExecFile);

  try {
    // STATIC exe + args — never accept renderer argv.
    const { stdout } = await run(FIXED_DISK_PS_EXE, [...FIXED_DISK_PS_ARGS], {
      shell: false,
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 256 * 1024,
      encoding: "utf8"
    });
    const disks = parseFixedDisksJson(String(stdout ?? ""), sweetCraftDriveLetter);
    return { available: true, disks, checkedAtMs };
  } catch {
    return emptyInventory(checkedAtMs);
  }
}
