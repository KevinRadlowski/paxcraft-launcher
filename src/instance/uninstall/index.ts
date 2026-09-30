import { lstat, readdir, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import type { InstancePaths } from "../layout/index.js";
import { assertValidLockLease, type InstanceLockLease } from "../lock/index.js";
import { ProgressEmitter } from "../events/index.js";
import { resolveSafeInstancePath } from "../security/index.js";
import {
  InstanceStateStore,
  createEmptyInstanceState,
  type InstanceState,
  type ManagedFileRecord
} from "../state/instanceState.js";
import { applyCompleteUninstall } from "./complete.js";
import { resolveCompleteUninstallContext } from "./pathGuard.js";

export type UninstallMode = "SAFE" | "COMPLETE";

export {
  resolveCompleteUninstallContext,
  assertCompleteUninstallTarget
} from "./pathGuard.js";
export type { CompleteUninstallContext } from "./pathGuard.js";

export interface UninstallOptions {
  mode: UninstallMode;
  paths: InstancePaths;
  /** Required for COMPLETE — canonical launcher-data root. */
  launcherDataRoot?: string;
  emitter?: ProgressEmitter;
  lockLease?: InstanceLockLease;
}

export interface SafeUninstallResult {
  outcome: "NOOP" | "SUCCESS";
  removedFiles: number;
  totalFiles: number;
  previousState: InstanceState;
}

export interface UninstallResult {
  mode: UninstallMode;
  outcome: "NOOP" | "SUCCESS";
  removedFiles: number;
  totalFiles: number;
  previousState?: InstanceState;
}

function isInstalledState(state: InstanceState): boolean {
  return (
    typeof state.installedPackVersion === "string" &&
    state.installedPackVersion.length > 0 &&
    typeof state.installedReleaseSequence === "number" &&
    Number.isInteger(state.installedReleaseSequence)
  );
}

function uniqueManagedFiles(files: readonly ManagedFileRecord[]): ManagedFileRecord[] {
  const seen = new Set<string>();
  const out: ManagedFileRecord[] = [];
  for (const f of files) {
    if (seen.has(f.targetPath)) continue;
    seen.add(f.targetPath);
    out.push(f);
  }
  return out;
}

async function removeManagedFile(
  paths: InstancePaths,
  file: ManagedFileRecord,
  emitter: ProgressEmitter
): Promise<void> {
  const abs = await resolveSafeInstancePath(paths, file.targetPath);
  let st;
  try {
    st = await lstat(abs);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
  if (st.isDirectory()) {
    throw new LauncherError(ErrorCode.UNSAFE_PATH, "managed path is a directory", {
      logicalId: file.logicalId
    });
  }
  if (st.isSymbolicLink()) {
    await rm(abs, { force: true });
  } else {
    await rm(abs, { force: true });
  }
  emitter.emit("FILE_REMOVED", { targetPath: file.targetPath, logicalId: file.logicalId });
}

async function removeEmptyManagedParentDirs(
  paths: InstancePaths,
  managedFiles: readonly ManagedFileRecord[]
): Promise<void> {
  const dirs = new Set<string>();
  for (const f of managedFiles) {
    const parts = f.targetPath.split("/");
    if (parts.length > 1) {
      dirs.add(parts.slice(0, -1).join("/"));
    }
  }
  const ordered = [...dirs].sort((a, b) => b.length - a.length);
  for (const rel of ordered) {
    try {
      const abs = await resolveSafeInstancePath(paths, rel);
      const entries = await readdir(abs);
      if (entries.length === 0) {
        await rmdir(abs);
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
      // Non-empty or foreign content — preserve directory.
    }
  }
}

export async function applyUninstall(opts: UninstallOptions): Promise<UninstallResult> {
  if (opts.mode === "COMPLETE") {
    if (!opts.launcherDataRoot?.trim()) {
      throw new LauncherError(ErrorCode.UNSAFE_PATH, "launcher data root required for complete uninstall");
    }
    const context = resolveCompleteUninstallContext(opts.launcherDataRoot, opts.paths.root);
    const completeOpts: Parameters<typeof applyCompleteUninstall>[0] = {
      paths: opts.paths,
      context
    };
    if (opts.lockLease) {
      completeOpts.lockLease = opts.lockLease;
    }
    if (opts.emitter) {
      completeOpts.emitter = opts.emitter;
    }
    const complete = await applyCompleteUninstall(completeOpts);
    return {
      mode: "COMPLETE",
      outcome: complete.outcome,
      removedFiles: complete.removedEntries,
      totalFiles: complete.removedEntries
    };
  }
  const safe = await applySafeUninstall(opts);
  return {
    mode: "SAFE",
    outcome: safe.outcome,
    removedFiles: safe.removedFiles,
    totalFiles: safe.totalFiles,
    previousState: safe.previousState
  };
}

/**
 * Remove only files listed in instance state (managed pack ownership).
 * Unmanaged user files, logs, saves-like paths outside state, and shared runtime are untouched.
 * State commit happens only after all deletions succeed (ENOENT tolerated).
 */
export async function applySafeUninstall(
  opts: Pick<UninstallOptions, "paths" | "emitter" | "lockLease">
): Promise<SafeUninstallResult> {
  const emitter = opts.emitter ?? new ProgressEmitter();
  if (opts.lockLease) {
    await assertValidLockLease(opts.paths, opts.lockLease);
  }

  const stateStore = new InstanceStateStore(opts.paths);
  const previousState = await stateStore.load();
  const managed = uniqueManagedFiles(previousState.files);
  const totalFiles = managed.length;

  if (!isInstalledState(previousState) && totalFiles === 0) {
    return { outcome: "NOOP", removedFiles: 0, totalFiles: 0, previousState };
  }

  emitter.emit("PLAN_READY", {
    dryRun: false,
    entryCount: totalFiles,
    summary: { download: 0, replace: 0, deleteManaged: totalFiles }
  });

  let removedFiles = 0;
  const failures: { targetPath: string; code: string }[] = [];

  for (const file of managed) {
    try {
      await removeManagedFile(opts.paths, file, emitter);
      removedFiles += 1;
    } catch (e) {
      const code = LauncherError.isLauncherError(e)
        ? e.code
        : (e as NodeJS.ErrnoException).code ?? "UNKNOWN";
      failures.push({ targetPath: file.targetPath, code: String(code) });
    }
  }

  if (failures.length > 0) {
    throw new LauncherError(ErrorCode.UNINSTALL_FAILED, "failed to remove one or more managed files", {
      failures,
      removedFiles,
      totalFiles
    });
  }

  await removeEmptyManagedParentDirs(opts.paths, managed);

  const empty = createEmptyInstanceState();
  await stateStore.saveAtomic(empty);
  emitter.emit("STATE_WRITTEN", { fileCount: 0 });

  return { outcome: "SUCCESS", removedFiles, totalFiles, previousState };
}
