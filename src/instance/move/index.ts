/**
 * PACK-10.1G / 10.1G.2 / 10.1G.5 / 10.1G.5.1 — SweetCraft instance tree migration.
 *
 * Transaction model (copy-first on all volumes):
 *   PREPARING → COPYING → VERIFYING → COMMIT_LOCATION → CLEANUP_SOURCE → FINALIZING
 *
 * Source remains authoritative until COMMIT_LOCATION succeeds.
 * Verification uses a pre-copy manifest with split semantics:
 *   stable paths  → exact entry/type/size
 *   volatile paths (logs/**) → present as file; size may grow during live copy
 */
import fs from "node:fs";
import { cp, lstat, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import {
  classifyMigrationDestination,
  validateInstancePathCandidate,
  type InstancePathGuardContext
} from "../paths/instanceLocation.js";
import { assertEmptyOrAbsentDestination } from "../ownership/index.js";
import { isVolatileMigrationPath } from "./volatilePaths.js";

export type MovePhase =
  | "PREPARING"
  | "COPYING"
  | "VERIFYING"
  | "COMMIT_LOCATION"
  | "CLEANUP_SOURCE"
  | "FINALIZING";

export interface MoveProgressSnapshot {
  readonly copiedBytes: number;
  readonly totalBytes: number;
  readonly indeterminate: boolean;
  readonly phase: MovePhase;
}

export interface MoveInstanceOptions {
  readonly sourceRoot: string;
  readonly destinationRoot: string;
  readonly guard: InstancePathGuardContext;
  readonly existsSync?: (p: string) => boolean;
  readonly copyTreeFn?: (from: string, to: string, ctx: CopyTreeContext) => Promise<void>;
  readonly computeSizeFn?: (root: string) => Promise<number>;
  readonly freeSpaceFn?: (destinationRoot: string) => Promise<number>;
  readonly removeSourceFn?: (sourceRoot: string) => Promise<void>;
  /** Called after destination verifies; must persist authoritative location before source cleanup. */
  readonly commitLocationFn?: (destinationRoot: string) => Promise<void>;
  readonly onProgress?: (p: MoveProgressSnapshot) => void;
}

export interface CopyTreeContext {
  readonly destinationExistedBefore: boolean;
}

export interface MoveInstanceResult {
  readonly strategy: "copy";
  readonly destinationRoot: string;
  readonly copiedBytes: number;
  /** True when destination verified, setting committed, but source tree could not be removed. */
  readonly sourceCleanupFailed?: boolean;
}

export interface TreeSnapshot {
  readonly entryCount: number;
  readonly totalBytes: number;
  readonly fileCount: number;
}

export interface TreeFileRecord {
  readonly relativePath: string;
  readonly size: number;
  readonly volatile: boolean;
}

export interface TreeManifest extends TreeSnapshot {
  readonly files: readonly TreeFileRecord[];
}

const COPY_OVERHEAD_BYTES = 64 * 1024 * 1024;

async function defaultCopyTree(from: string, to: string, _ctx: CopyTreeContext): Promise<void> {
  // force:true supports absent destination and pre-existing empty directory (avoids ERR_FS_CP_EEXIST).
  await cp(from, to, { recursive: true, force: true });
}

async function computeDirectorySize(root: string): Promise<number> {
  let total = 0;
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const st = await lstat(full);
        total += st.size;
      }
    }
  }
  await walk(root);
  return total;
}

async function defaultFreeSpace(destinationRoot: string): Promise<number> {
  if (process.platform !== "win32") {
    return Number.MAX_SAFE_INTEGER;
  }
  const drive = path.parse(path.resolve(destinationRoot)).root;
  if (!drive) return Number.MAX_SAFE_INTEGER;
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive.replace("\\", "")}'").FreeSpace`
      ],
      { windowsHide: true, timeout: 10_000, encoding: "utf8" }
    );
    const free = Number(String(stdout).trim());
    return Number.isFinite(free) && free >= 0 ? free : Number.MAX_SAFE_INTEGER;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

async function scanTreeSnapshot(root: string): Promise<TreeSnapshot> {
  const manifest = await buildTreeManifest(root);
  return {
    entryCount: manifest.entryCount,
    totalBytes: manifest.totalBytes,
    fileCount: manifest.fileCount
  };
}

/** Immutable source manifest captured before copy — verification never re-reads live source. */
async function buildTreeManifest(root: string): Promise<TreeManifest> {
  let entryCount = 0;
  let totalBytes = 0;
  let fileCount = 0;
  const files: TreeFileRecord[] = [];
  const base = path.resolve(root);

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      entryCount += 1;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        fileCount += 1;
        const st = await lstat(full);
        totalBytes += st.size;
        const relativePath = path.relative(base, full).split(path.sep).join("/");
        files.push({
          relativePath,
          size: st.size,
          volatile: isVolatileMigrationPath(relativePath)
        });
      }
    }
  }

  await walk(base);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { entryCount, totalBytes, fileCount, files };
}

/** Verify destination against pre-copy manifest (not live source). */
async function verifyTreeAgainstManifest(manifest: TreeManifest, destination: string): Promise<void> {
  const dstSnap = await scanTreeSnapshot(destination);
  if (manifest.entryCount !== dstSnap.entryCount) {
    throw new LauncherError(ErrorCode.INTERNAL_ERROR, "destination verification failed: entry count mismatch", {
      sourceEntries: manifest.entryCount,
      destinationEntries: dstSnap.entryCount
    });
  }
  if (manifest.fileCount !== dstSnap.fileCount) {
    throw new LauncherError(ErrorCode.INTERNAL_ERROR, "destination verification failed: file count mismatch", {
      sourceFiles: manifest.fileCount,
      destinationFiles: dstSnap.fileCount
    });
  }

  let stableManifestBytes = 0;
  let stableDestinationBytes = 0;

  for (const file of manifest.files) {
    const dstPath = path.join(destination, ...file.relativePath.split("/"));
    let st;
    try {
      st = await lstat(dstPath);
    } catch {
      throw new LauncherError(ErrorCode.INTERNAL_ERROR, "destination verification failed: missing entry", {
        name: file.relativePath
      });
    }
    if (!st.isFile()) {
      throw new LauncherError(ErrorCode.INTERNAL_ERROR, "destination verification failed: not a file", {
        name: file.relativePath
      });
    }

    if (file.volatile) {
      if (st.size < file.size) {
        throw new LauncherError(
          ErrorCode.INTERNAL_ERROR,
          "destination verification failed: volatile file shrank",
          {
            name: file.relativePath,
            manifestSize: file.size,
            actualSize: st.size
          }
        );
      }
      continue;
    }

    stableManifestBytes += file.size;
    stableDestinationBytes += st.size;
    if (st.size !== file.size) {
      throw new LauncherError(ErrorCode.INTERNAL_ERROR, "destination verification failed: file size mismatch", {
        name: file.relativePath,
        expectedSize: file.size,
        actualSize: st.size,
        volatile: false
      });
    }
  }

  if (stableManifestBytes !== stableDestinationBytes) {
    throw new LauncherError(ErrorCode.INTERNAL_ERROR, "destination verification failed: stable size mismatch", {
      stableManifestBytes,
      stableDestinationBytes
    });
  }
}

async function removeDirectoryTree(target: string): Promise<void> {
  if (fs.existsSync(target)) {
    await rm(target, { recursive: true, force: true, maxRetries: 2 });
  }
}

/** Remove copied contents but preserve an pre-existing empty destination shell. */
async function clearDirectoryContents(dir: string): Promise<void> {
  if (!fs.existsSync(dir)) return;
  const entries = await readdir(dir);
  for (const entry of entries) {
    await rm(path.join(dir, entry), { recursive: true, force: true, maxRetries: 2 });
  }
}

async function rollbackFailedDestination(opts: {
  destination: string;
  destinationExistedBefore: boolean;
  destinationCreatedByMove: boolean;
}): Promise<{ removed: boolean; preservedEmptyShell: boolean }> {
  try {
    if (opts.destinationCreatedByMove || !opts.destinationExistedBefore) {
      await removeDirectoryTree(opts.destination);
      return { removed: true, preservedEmptyShell: false };
    }
    await clearDirectoryContents(opts.destination);
    if (!fs.existsSync(opts.destination)) {
      await fs.promises.mkdir(opts.destination, { recursive: true });
    }
    return { removed: false, preservedEmptyShell: true };
  } catch {
    return { removed: false, preservedEmptyShell: false };
  }
}

function nativeErrorCode(e: unknown): string | undefined {
  if (typeof e === "object" && e !== null && "code" in e) {
    const code = (e as { code: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function moveFailure(
  phase: MovePhase,
  e: unknown,
  extra: Record<string, unknown> = {}
): LauncherError {
  const cause = LauncherError.isLauncherError(e) ? e.code : String(e);
  const nativeCode = nativeErrorCode(e);
  return new LauncherError(ErrorCode.INSTANCE_MOVE_FAILED, "instance migration failed", {
    phase,
    preservedSource: true,
    cause,
    ...(nativeCode ? { nativeCode } : {}),
    ...extra
  });
}

/**
 * Move the full SweetCraft instance tree to destination using copy-first semantics.
 * Location setting must be committed via commitLocationFn before source cleanup.
 */
export async function moveInstanceTree(opts: MoveInstanceOptions): Promise<MoveInstanceResult> {
  const source = path.resolve(opts.sourceRoot);
  const validation = validateInstancePathCandidate(opts.destinationRoot, opts.guard, {
    sourceRoot: source
  });
  if (!validation.ok || !validation.canonicalPath) {
    throw new LauncherError(ErrorCode.UNSAFE_PATH, "invalid migration destination", {
      reason: validation.reason
    });
  }
  const destination = validation.canonicalPath;
  const existsSync = opts.existsSync ?? fs.existsSync;

  if (!existsSync(source)) {
    throw new LauncherError(ErrorCode.INSTANCE_NOT_INSTALLED, "source instance missing");
  }

  const destinationExistedBefore = existsSync(destination);

  try {
    assertEmptyOrAbsentDestination(destination, existsSync);
  } catch (e) {
    if (LauncherError.isLauncherError(e)) {
      const classification = classifyMigrationDestination(destination, existsSync);
      throw new LauncherError(ErrorCode.UNSAFE_PATH, "destination is not empty", {
        classification,
        cause: e.code
      });
    }
    throw e;
  }

  opts.onProgress?.({ copiedBytes: 0, totalBytes: 0, indeterminate: true, phase: "PREPARING" });

  const sourceManifest = await buildTreeManifest(source);
  const totalBytes = sourceManifest.totalBytes;
  const freeSpaceFn = opts.freeSpaceFn ?? defaultFreeSpace;
  const freeBytes = await freeSpaceFn(destination);
  if (freeBytes < totalBytes + COPY_OVERHEAD_BYTES) {
    throw new LauncherError(ErrorCode.INSUFFICIENT_DISK_SPACE, "insufficient disk space for migration", {
      requiredBytes: totalBytes + COPY_OVERHEAD_BYTES,
      freeBytes,
      phase: "PREPARING"
    });
  }

  const copyTreeFn = opts.copyTreeFn ?? defaultCopyTree;
  const copyCtx: CopyTreeContext = { destinationExistedBefore };

  if (!destinationExistedBefore) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
  }

  opts.onProgress?.({
    copiedBytes: 0,
    totalBytes,
    indeterminate: false,
    phase: "COPYING"
  });

  const destinationCreatedByMove = !destinationExistedBefore;

  try {
    await copyTreeFn(source, destination, copyCtx);

    opts.onProgress?.({
      copiedBytes: totalBytes,
      totalBytes,
      indeterminate: false,
      phase: "VERIFYING"
    });
    await verifyTreeAgainstManifest(sourceManifest, destination);

    opts.onProgress?.({
      copiedBytes: totalBytes,
      totalBytes,
      indeterminate: false,
      phase: "COMMIT_LOCATION"
    });

    const commitLocation =
      opts.commitLocationFn ??
      (async () => {
        /* Tests may omit commitLocationFn to exercise filesystem-only phases. */
      });

    try {
      await commitLocation(destination);
    } catch (e) {
      const cleanup = await rollbackFailedDestination({
        destination,
        destinationExistedBefore,
        destinationCreatedByMove
      });
      throw moveFailure("COMMIT_LOCATION", e, {
        destinationCleanup: cleanup,
        destinationExistedBefore,
        destinationCreatedByMove
      });
    }

    opts.onProgress?.({
      copiedBytes: totalBytes,
      totalBytes,
      indeterminate: false,
      phase: "CLEANUP_SOURCE"
    });

    const removeSource =
      opts.removeSourceFn ??
      ((src: string) => rm(src, { recursive: true, force: true, maxRetries: 2 }));
    let sourceCleanupFailed = false;
    try {
      await removeSource(source);
    } catch {
      sourceCleanupFailed = true;
    }

    opts.onProgress?.({
      copiedBytes: totalBytes,
      totalBytes,
      indeterminate: false,
      phase: "FINALIZING"
    });

    return {
      strategy: "copy",
      destinationRoot: destination,
      copiedBytes: totalBytes,
      ...(sourceCleanupFailed ? { sourceCleanupFailed: true } : {})
    };
  } catch (e) {
    if (LauncherError.isLauncherError(e) && e.details?.preservedSource === true) {
      throw e;
    }
    const native = nativeErrorCode(e);
    const phase: MovePhase =
      LauncherError.isLauncherError(e) && e.message.includes("verification")
        ? "VERIFYING"
        : native === "EEXIST" || native?.startsWith("ERR_FS_CP")
          ? "COPYING"
          : "COPYING";
    const cleanup = await rollbackFailedDestination({
      destination,
      destinationExistedBefore,
      destinationCreatedByMove
    });
    throw moveFailure(phase, e, {
      destinationCleanup: cleanup,
      destinationExistedBefore,
      destinationCreatedByMove
    });
  }
}

export {
  computeDirectorySize,
  classifyMigrationDestination,
  scanTreeSnapshot,
  buildTreeManifest,
  verifyTreeAgainstManifest
};
export { isVolatileMigrationPath } from "./volatilePaths.js";
