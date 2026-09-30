import { access, lstat, readdir, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import type { InstancePaths } from "../layout/index.js";
import { assertValidLockLease, type InstanceLockLease } from "../lock/index.js";
import { ProgressEmitter } from "../events/index.js";
import {
  assertCompleteUninstallTarget,
  type CompleteUninstallContext
} from "./pathGuard.js";

export interface CompleteUninstallOptions {
  paths: InstancePaths;
  context: CompleteUninstallContext;
  emitter?: ProgressEmitter;
  lockLease?: InstanceLockLease;
}

export interface CompleteUninstallResult {
  outcome: "NOOP" | "SUCCESS";
  removedEntries: number;
}

async function pathExists(abs: string): Promise<boolean> {
  try {
    await access(abs);
    return true;
  } catch {
    return false;
  }
}

/** Remove one directory entry without following symlinks or junctions. */
async function removeEntryNoFollow(absPath: string): Promise<void> {
  let st;
  try {
    st = await lstat(absPath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }

  if (st.isSymbolicLink()) {
    await rm(absPath, { force: true });
    return;
  }

  if (st.isFile() || st.isCharacterDevice() || st.isBlockDevice() || st.isFIFO() || st.isSocket()) {
    await rm(absPath, { force: true });
    return;
  }

  if (st.isDirectory()) {
    const entries = await readdir(absPath);
    for (const entry of entries) {
      await removeEntryNoFollow(path.join(absPath, entry));
    }
    await rmdir(absPath);
  }
}

/**
 * Delete all contents of the canonical SweetCraft instance root, then the root itself.
 * Does not follow symlinks/junctions — link entries are removed, external targets preserved.
 * Install metadata under launcher/ inside the instance is removed with the tree.
 * State is NOT written here; caller refreshes status after filesystem success.
 */
export async function applyCompleteUninstall(
  opts: CompleteUninstallOptions
): Promise<CompleteUninstallResult> {
  const emitter = opts.emitter ?? new ProgressEmitter();
  if (opts.lockLease) {
    await assertValidLockLease(opts.paths, opts.lockLease);
  }

  const { deleteMode } = assertCompleteUninstallTarget(opts.paths, opts.context);

  const root = path.resolve(opts.paths.root);
  if (deleteMode === "NOOP" || !(await pathExists(root))) {
    return { outcome: "NOOP", removedEntries: 0 };
  }

  if (deleteMode === "EMPTY_ONLY") {
    const entries = await readdir(root);
    if (entries.length > 0) {
      throw new LauncherError(ErrorCode.INSTANCE_OWNERSHIP_NOT_PROVEN, "refusing to delete non-empty unrecognized root", {
        mode: "COMPLETE"
      });
    }
    await rmdir(root);
    emitter.emit("STATE_WRITTEN", { fileCount: 0, mode: "COMPLETE" });
    return { outcome: "SUCCESS", removedEntries: 0 };
  }

  const entries = await readdir(root);
  emitter.emit("PLAN_READY", {
    dryRun: false,
    entryCount: entries.length,
    summary: { download: 0, replace: 0, deleteManaged: entries.length }
  });

  let removedEntries = 0;
  const failures: { name: string; code: string }[] = [];

  for (const entry of entries) {
    const abs = path.join(root, entry);
    try {
      await removeEntryNoFollow(abs);
      removedEntries += 1;
      emitter.emit("FILE_REMOVED", { targetPath: entry });
    } catch (e) {
      const code = LauncherError.isLauncherError(e)
        ? e.code
        : (e as NodeJS.ErrnoException).code ?? "UNKNOWN";
      failures.push({ name: entry, code: String(code) });
    }
  }

  if (failures.length > 0) {
    throw new LauncherError(ErrorCode.UNINSTALL_FAILED, "failed to remove one or more instance entries", {
      failures,
      removedEntries,
      totalEntries: entries.length,
      mode: "COMPLETE"
    });
  }

  try {
    await rmdir(root);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      const remaining = await readdir(root).catch(() => [] as string[]);
      if (remaining.length > 0) {
        throw new LauncherError(ErrorCode.UNINSTALL_FAILED, "instance root is not empty after deletion", {
          remainingCount: remaining.length,
          mode: "COMPLETE"
        });
      }
      throw e;
    }
  }

  emitter.emit("STATE_WRITTEN", { fileCount: 0, mode: "COMPLETE" });
  return { outcome: "SUCCESS", removedEntries };
}
