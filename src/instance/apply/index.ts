import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import type { TrustedResolvedRelease } from "../../core/resolve/index.js";
import { DownloadEngine } from "../../download/engine/index.js";
import type { HttpClient } from "../../distribution/http/index.js";
import type { ByteSource } from "../../download/engine/types.js";
import { cleanupTemp, ensureDir, hashFileSha256Simple, replaceFile } from "../../download/fs/index.js";
import { withAcceptedRelease, type AntiRollbackState, type CandidateReleaseIdentity, FileAntiRollbackStore } from "../state/index.js";
import {
  InstanceStateStore,
  mergePriorPackVersions,
  type InstanceState,
  type ManagedFileRecord
} from "../state/instanceState.js";
import type { InstancePaths } from "../layout/index.js";
import { assertFinalPathInsideInstance, resolveSafeInstancePath } from "../security/index.js";
import { InstanceLock, assertValidLockLease, type InstanceLockLease } from "../lock/index.js";
import { ProgressEmitter } from "../events/index.js";
import { buildInstallationPlan, type InstallationPlan, type PlanEntry } from "../plan/index.js";
import { applyConfigMigrations } from "../configMigration/apply.js";
import { reconcileMissedConfigMigrations } from "../configMigration/missedRecovery.js";
import { applyFirstRunSeeds } from "../firstRun/seed.js";

export interface ApplyOptions {
  resolved: TrustedResolvedRelease;
  paths: InstancePaths;
  source: ByteSource;
  /** Resolves unknown config download sizes before PLAN_READY / first pack byte. */
  http?: HttpClient;
  signal?: AbortSignal;
  dryRun?: boolean;
  forceStaleLock?: boolean;
  emitter?: ProgressEmitter;
  /** Optional anti-rollback store to update after successful install (legacy path only). */
  antiRollbackStore?: FileAntiRollbackStore;
  antiRollbackState?: AntiRollbackState;
  /**
   * When true: mutate files + build nextState but do NOT write state.json
   * and do NOT update anti-rollback. Caller must commit via returned pending.
   * Requires `lockLease` (orchestrator already holds the lock).
   */
  deferStateCommit?: boolean;
  /**
   * Explicit lock lease from InstanceLock.acquire(). When set, apply does not
   * acquire/release the instance lock. Boolean bypass is intentionally unsupported.
   */
  lockLease?: InstanceLockLease;
  /** Repair-only: reconcile config migrations missed by an older launcher build. */
  reconcileMissedMigrations?: boolean;
}

export interface ApplyResult {
  plan: InstallationPlan;
  /** State currently authoritative on disk after this call. */
  state: InstanceState;
  dryRun: boolean;
  /**
   * Present only when deferStateCommit=true.
   * Filesystem may already match nextState; disk state.json still equals `state` (previous).
   */
  pending?: PendingInstallationCommit;
}

/**
 * Deferred commit handle — only obtained from applyInstallation({ deferStateCommit: true, lockLease }).
 */
export interface PendingInstallationCommit {
  readonly plan: InstallationPlan;
  readonly previousState: InstanceState;
  readonly nextState: InstanceState;
  /**
   * Atomically persist instance state, then optionally anti-rollback.
   * Must be called only after final audit succeeds.
   */
  commit(opts?: {
    antiRollbackStore?: FileAntiRollbackStore;
    antiRollbackState?: AntiRollbackState;
    emitter?: ProgressEmitter;
  }): Promise<void>;
}

/**
 * Legacy public API — acquires lock, applies files, commits state (+ optional anti-rollback), releases.
 * Behavior preserved for existing callers/tests.
 */
export async function applyInstallation(opts: ApplyOptions): Promise<ApplyResult> {
  const emitter = opts.emitter ?? new ProgressEmitter();

  if (opts.dryRun === true) {
    const stateStore = new InstanceStateStore(opts.paths);
    const state = await stateStore.load();
    const plan = await buildInstallationPlan({
      resolved: opts.resolved,
      state,
      paths: opts.paths,
      dryRun: true,
      emitter,
      ...(opts.http ? { http: opts.http } : {}),
      ...(opts.signal ? { signal: opts.signal } : {})
    });
    return { plan, state, dryRun: true };
  }

  const defer = opts.deferStateCommit === true;
  if (defer && !opts.lockLease) {
    throw new LauncherError(
      ErrorCode.INSTANCE_LOCKED,
      "deferStateCommit requires an explicit InstanceLockLease"
    );
  }
  if (opts.lockLease && !defer && opts.antiRollbackStore) {
    // Under held lock without defer: still allowed for advanced callers, but orchestrator uses defer.
  }

  let ownedLock: InstanceLock | null = null;
  if (opts.lockLease) {
    await assertValidLockLease(opts.paths, opts.lockLease);
  } else {
    ownedLock = new InstanceLock(opts.paths);
    await ownedLock.acquire("install", {
      forceStale: opts.forceStaleLock === true
    });
  }

  try {
    const prepared = await applyFilesystemMutations({
      resolved: opts.resolved,
      paths: opts.paths,
      source: opts.source,
      emitter,
      reconcileMissedMigrations: opts.reconcileMissedMigrations === true,
      ...(opts.http ? { http: opts.http } : {}),
      ...(opts.signal ? { signal: opts.signal } : {})
    });

    if (defer) {
      const pending = createPendingCommit(
        opts.paths,
        prepared.plan,
        prepared.previousState,
        prepared.nextState,
        opts.resolved.candidate
      );
      return {
        plan: prepared.plan,
        state: prepared.previousState,
        dryRun: false,
        pending
      };
    }

    const stateStore = new InstanceStateStore(opts.paths);
    await stateStore.saveAtomic(prepared.nextState);
    emitter.emit("STATE_WRITTEN", {
      packVersion: prepared.nextState.installedPackVersion,
      releaseSequence: prepared.nextState.installedReleaseSequence,
      fileCount: prepared.nextState.files.length
    });

    if (opts.antiRollbackStore && opts.antiRollbackState) {
      const updated = withAcceptedRelease(opts.antiRollbackState, opts.resolved.candidate);
      await opts.antiRollbackStore.saveAtomic(updated);
    }

    emitter.emit("INSTALL_COMPLETE", {
      packVersion: prepared.plan.packVersion,
      summary: { ...prepared.plan.summary }
    });

    return { plan: prepared.plan, state: prepared.nextState, dryRun: false };
  } finally {
    if (ownedLock) {
      await ownedLock.release();
    }
  }
}

function createPendingCommit(
  paths: InstancePaths,
  plan: InstallationPlan,
  previousState: InstanceState,
  nextState: InstanceState,
  candidate: CandidateReleaseIdentity
): PendingInstallationCommit {
  let committed = false;
  return {
    plan,
    previousState,
    nextState,
    async commit(opts = {}) {
      if (committed) {
        throw new LauncherError(ErrorCode.INTERNAL_ERROR, "pending installation already committed");
      }
      const emitter = opts.emitter ?? new ProgressEmitter();
      const stateStore = new InstanceStateStore(paths);
      await stateStore.saveAtomic(nextState);
      committed = true;
      emitter.emit("STATE_WRITTEN", {
        packVersion: nextState.installedPackVersion,
        releaseSequence: nextState.installedReleaseSequence,
        fileCount: nextState.files.length
      });

      if (opts.antiRollbackStore && opts.antiRollbackState) {
        try {
          const updated = withAcceptedRelease(opts.antiRollbackState, candidate);
          await opts.antiRollbackStore.saveAtomic(updated);
        } catch (e) {
          throw new LauncherError(
            ErrorCode.ANTI_ROLLBACK_PERSIST_FAILED,
            "instance state committed but anti-rollback persistence failed",
            {
              packVersion: nextState.installedPackVersion,
              releaseSequence: nextState.installedReleaseSequence,
              cause: LauncherError.isLauncherError(e) ? e.code : "UNKNOWN"
            }
          );
        }
      }

      emitter.emit("INSTALL_COMPLETE", {
        packVersion: plan.packVersion,
        summary: { ...plan.summary }
      });
    }
  };
}

async function applyFilesystemMutations(opts: {
  resolved: TrustedResolvedRelease;
  paths: InstancePaths;
  source: ByteSource;
  emitter: ProgressEmitter;
  reconcileMissedMigrations?: boolean;
  http?: HttpClient;
  signal?: AbortSignal;
}): Promise<{
  plan: InstallationPlan;
  previousState: InstanceState;
  nextState: InstanceState;
}> {
  await ensureDir(opts.paths.modsDir());
  await ensureDir(opts.paths.configDir());
  await ensureDir(opts.paths.resourcePacksDir());
  await ensureDir(opts.paths.tmpDir());
  await ensureDir(opts.paths.downloadsDir());
  await ensureDir(opts.paths.logsDir());

  const stateStore = new InstanceStateStore(opts.paths);
  const previousState = await stateStore.load();

  const plan = await buildInstallationPlan({
    resolved: opts.resolved,
    state: previousState,
    paths: opts.paths,
    dryRun: false,
    emitter: opts.emitter,
    ...(opts.http ? { http: opts.http } : {}),
    ...(opts.signal ? { signal: opts.signal } : {})
  });

  const engine = new DownloadEngine({
    source: opts.source,
    tmpDir: opts.paths.tmpDir(),
    emitter: opts.emitter
  });

  const downloaded = new Map<string, { tempPath: string; sha256: string; size: number }>();

  try {
    for (const entry of plan.entries) {
      if (entry.action !== "DOWNLOAD" && entry.action !== "REPLACE") continue;
      if (!entry.download) {
        throw new LauncherError(ErrorCode.INTERNAL_ERROR, "plan entry missing download", {
          logicalId: entry.logicalId
        });
      }
      const result = await engine.download(entry.download);
      downloaded.set(entry.targetPath, {
        tempPath: result.tempPath,
        sha256: result.sha256,
        size: result.size
      });
    }

    const nextFiles: ManagedFileRecord[] = [];
    for (const entry of plan.entries) {
      await applyEntry(opts.paths, entry, downloaded, nextFiles, opts.emitter);
    }

    let managedFiles = nextFiles;
    const migrations = opts.resolved.clientManifest.configMigrations ?? [];
    const appliedConfigMigrations = [...(previousState.appliedConfigMigrations ?? [])];

    if (migrations.length > 0) {
      const migrationResult = await applyConfigMigrations({
        migrations,
        paths: opts.paths,
        previousState,
        managedFiles
      });
      managedFiles = migrationResult.files;
      for (const id of migrationResult.appliedIds) {
        if (!appliedConfigMigrations.includes(id)) {
          appliedConfigMigrations.push(id);
        }
      }
    }

    const priorPackVersions = mergePriorPackVersions(previousState, plan.packVersion);
    let nextState: InstanceState = {
      schemaVersion: 1,
      installedPackVersion: plan.packVersion,
      installedReleaseSequence: plan.releaseSequence,
      installedReleaseSha256: plan.releaseSha256,
      installedManifestSha256: plan.manifestSha256,
      channel: plan.channel,
      productBase: plan.productBase,
      files: managedFiles,
      ...(appliedConfigMigrations.length > 0 ? { appliedConfigMigrations } : {}),
      ...(previousState.appliedFirstRunSeeds && previousState.appliedFirstRunSeeds.length > 0
        ? { appliedFirstRunSeeds: [...previousState.appliedFirstRunSeeds] }
        : {}),
      ...(priorPackVersions ? { priorPackVersions } : {}),
      updatedAt: new Date().toISOString()
    };

    if (opts.reconcileMissedMigrations) {
      const recovered = await reconcileMissedConfigMigrations({
        state: nextState,
        resolved: opts.resolved,
        paths: opts.paths
      });
      if (recovered) {
        nextState = recovered.nextState;
      }
    }

    const firstRun = await applyFirstRunSeeds({
      paths: opts.paths,
      state: nextState,
      managedFiles
    });
    if (firstRun) {
      nextState = firstRun.nextState;
    }

    return { plan, previousState, nextState };
  } finally {
    for (const d of downloaded.values()) {
      await cleanupTemp(d.tempPath);
    }
  }
}

async function applyEntry(
  paths: InstancePaths,
  entry: PlanEntry,
  downloaded: Map<string, { tempPath: string; sha256: string; size: number }>,
  nextFiles: ManagedFileRecord[],
  emitter: ProgressEmitter
): Promise<void> {
  const abs = await resolveSafeInstancePath(paths, entry.targetPath);

  if (entry.action === "KEEP" || entry.action === "SKIP" || entry.action === "VERIFY") {
    if (entry.action === "KEEP") {
      const h = await hashFileSha256Simple(abs);
      nextFiles.push(toManaged(entry, h.size, h.sha256));
      emitter.emit("FILE_KEPT", { targetPath: entry.targetPath, logicalId: entry.logicalId });
    }
    return;
  }

  if (entry.action === "DELETE_MANAGED") {
    await rm(abs, { force: true }).catch(() => undefined);
    emitter.emit("FILE_REMOVED", { targetPath: entry.targetPath, logicalId: entry.logicalId });
    return;
  }

  if (entry.action === "DOWNLOAD" || entry.action === "REPLACE" || entry.action === "INSTALL") {
    const d = downloaded.get(entry.targetPath);
    if (!d) {
      throw new LauncherError(ErrorCode.INTERNAL_ERROR, "missing verified download for apply", {
        targetPath: entry.targetPath
      });
    }
    await mkdir(path.dirname(abs), { recursive: true });
    await replaceFile(d.tempPath, abs);
    await assertFinalPathInsideInstance(paths, abs);
    downloaded.delete(entry.targetPath);
    nextFiles.push(toManaged(entry, d.size, d.sha256));
    emitter.emit("FILE_INSTALLED", {
      targetPath: entry.targetPath,
      logicalId: entry.logicalId,
      sha256: d.sha256,
      size: d.size
    });
  }
}

function toManaged(entry: PlanEntry, size?: number, sha256?: string): ManagedFileRecord {
  const rec: ManagedFileRecord = {
    type: entry.kind,
    logicalId: entry.logicalId,
    targetPath: entry.targetPath,
    sha256: sha256 ?? entry.expectedSha256,
    size: size ?? (entry.expectedSize >= 0 ? entry.expectedSize : 0),
    source: "manifest"
  };
  if (entry.policy) rec.policy = entry.policy;
  if (entry.autoEnable !== undefined) rec.autoEnable = entry.autoEnable;
  return rec;
}
