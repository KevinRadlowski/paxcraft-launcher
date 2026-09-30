import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import type { ClientApplyMode, ManifestConfig } from "../../core/manifest/index.js";
import type { TrustedResolvedRelease } from "../../core/resolve/index.js";
import { assertSafeConfigPath, assertSafeResourcePackTargetPath } from "../../core/paths/index.js";
import type { DownloadRequest } from "../../download/engine/types.js";
import { ProviderResolver } from "../../download/providers/index.js";
import { hashFileSha256Simple } from "../../download/fs/index.js";
import type { InstancePaths } from "../layout/index.js";
import { resolveSafeInstancePath } from "../security/index.js";
import type { InstanceState } from "../state/instanceState.js";
import type { ProgressEmitter } from "../events/index.js";
import type { HttpClient } from "../../distribution/http/index.js";
import { enrichPackPlanDownloadSizes } from "./enrichDownloadSizes.js";
import { summarizePlannedDownloadBytes } from "./plannedDownloadBytes.js";

export type PlanAction =
  | "DOWNLOAD"
  | "INSTALL"
  | "REPLACE"
  | "KEEP"
  | "DELETE_MANAGED"
  | "SKIP"
  | "VERIFY";

export type PlanEntryKind = "mod" | "config" | "resourcePack";

export interface PlanEntry {
  readonly action: PlanAction;
  readonly kind: PlanEntryKind;
  readonly logicalId: string;
  readonly targetPath: string;
  readonly expectedSha256: string;
  readonly expectedSize: number;
  readonly download?: DownloadRequest;
  readonly policy?: ClientApplyMode;
  readonly autoEnable?: boolean;
  /** Machine-readable reason */
  readonly reason: string;
}

export interface InstallationPlan {
  readonly dryRun: boolean;
  readonly packVersion: string;
  readonly releaseSequence: number;
  readonly releaseSha256: string;
  readonly manifestSha256: string;
  readonly channel: string;
  readonly productBase: string;
  readonly entries: readonly PlanEntry[];
  readonly summary: PlanSummary;
}

export interface PlanSummary {
  download: number;
  install: number;
  replace: number;
  keep: number;
  deleteManaged: number;
  skip: number;
  verify: number;
}

export interface BuildPlanOptions {
  resolved: TrustedResolvedRelease;
  state: InstanceState;
  paths: InstancePaths;
  dryRun?: boolean;
  emitter?: ProgressEmitter;
  resolver?: ProviderResolver;
  /** When set, unknown config download sizes are resolved via HTTPS HEAD before PLAN_READY. */
  http?: HttpClient;
  signal?: AbortSignal;
}

/**
 * Config policy contract (exact):
 *
 * force:
 *   absent → DOWNLOAD/INSTALL
 *   present + hash match → KEEP
 *   present + hash mismatch → REPLACE (download)
 *
 * if_missing:
 *   absent → DOWNLOAD/INSTALL
 *   present (any hash) → KEEP / PRESERVED (never overwrite)
 *
 * never_overwrite:
 *   absent → DOWNLOAD/INSTALL (seed once)
 *   present (any hash) → KEEP (never overwrite) — same disk semantics as if_missing;
 *   semantic difference is catalog policy intent (CLIENT_PRESERVE vs CLIENT_DEFAULT),
 *   not launcher overwrite behavior.
 */
export async function buildInstallationPlan(opts: BuildPlanOptions): Promise<InstallationPlan> {
  const dryRun = opts.dryRun === true;
  opts.emitter?.emit("PLAN_STARTED", { dryRun, packVersion: opts.resolved.release.release.packVersion });

  if (!opts.resolved.trusted) {
    throw new LauncherError(ErrorCode.INTERNAL_ERROR, "refusing to plan from untrusted release");
  }

  const manifest = opts.resolved.clientManifest;
  const release = opts.resolved.release.release;
  const resolver = opts.resolver ?? new ProviderResolver();
  const productBase = opts.resolved.productBase;
  const packVersion = release.packVersion;
  const manifestSha256 = opts.resolved.release.release.artefacts.clientManifest.sha256;

  const entries: PlanEntry[] = [];
  const targetIndex = new Map<string, string>(); // targetPath → logicalId

  // --- Mods ---
  for (const mod of manifest.mods) {
    if (!mod.file || mod.file.includes("/") || mod.file.includes("\\") || mod.file.includes("..")) {
      throw new LauncherError(ErrorCode.UNSAFE_PATH, `unsafe mod file basename`, { file: mod.file });
    }
    const targetPath = `mods/${mod.file}`;
    claimTarget(targetIndex, targetPath, mod.id);
    await resolveSafeInstancePath(opts.paths, targetPath);

    const abs = opts.paths.absoluteForRelative(targetPath);
    const exists = await fileExists(abs);
    let onDiskHash: string | null = null;
    let onDiskSize = 0;
    if (exists) {
      const h = await hashFileSha256Simple(abs);
      onDiskHash = h.sha256;
      onDiskSize = h.size;
    }

    const download = resolver.resolveModDownload(mod);
    if (exists && onDiskHash === mod.sha256 && onDiskSize === mod.size) {
      entries.push({
        action: "KEEP",
        kind: "mod",
        logicalId: mod.id,
        targetPath,
        expectedSha256: mod.sha256,
        expectedSize: mod.size,
        reason: "mod_hash_match"
      });
    } else if (exists) {
      entries.push({
        action: "REPLACE",
        kind: "mod",
        logicalId: mod.id,
        targetPath,
        expectedSha256: mod.sha256,
        expectedSize: mod.size,
        download,
        reason: "mod_corrupt_or_outdated"
      });
    } else {
      entries.push({
        action: "DOWNLOAD",
        kind: "mod",
        logicalId: mod.id,
        targetPath,
        expectedSha256: mod.sha256,
        expectedSize: mod.size,
        download,
        reason: "mod_missing"
      });
    }
  }

  // --- Configs ---
  for (const cfg of manifest.configs) {
    assertSafeConfigPath(cfg.path);
    const targetPath = cfg.path; // already config/...
    claimTarget(targetIndex, targetPath, cfg.path);
    await resolveSafeInstancePath(opts.paths, targetPath);

    const abs = opts.paths.absoluteForRelative(targetPath);
    const exists = await fileExists(abs);
    const download = resolver.resolveCdnFile({
      productBase,
      packVersion,
      relativeUnderFiles: cfg.path,
      expectedSha256: cfg.sha256,
      expectedSize: 0, // size not in manifest config — use max guard only; verify hash only
      id: `config:${cfg.path}`,
      targetPath
    });
    // Configs in manifest don't carry size — set expectedSize from download after we know.
    // For planning: we still require hash; size check uses downloaded bytes vs optional.
    // Adjust: use maxBytes only; expectedSize 0 means "hash-only" in engine — better to skip size equality when 0.
    // We'll patch DownloadEngine to allow expectedSize < 0 or use a flag.
    // Simpler approach: when size unknown, set expectedSize to -1 and engine skips size equality if expectedSize < 0.

    const entry = planConfig(cfg, targetPath, exists, abs, download);
    entries.push(await entry);
  }

  // --- Resource packs ---
  for (const rp of manifest.resourcePacks) {
    assertSafeResourcePackTargetPath(rp.targetPath);
    claimTarget(targetIndex, rp.targetPath, rp.id);
    await resolveSafeInstancePath(opts.paths, rp.targetPath);

    const abs = opts.paths.absoluteForRelative(rp.targetPath);
    const exists = await fileExists(abs);
    let onDiskHash: string | null = null;
    let onDiskSize = 0;
    if (exists) {
      const h = await hashFileSha256Simple(abs);
      onDiskHash = h.sha256;
      onDiskSize = h.size;
    }
    const download = resolver.resolveCdnFile({
      productBase,
      packVersion,
      relativeUnderFiles: rp.targetPath,
      expectedSha256: rp.sha256,
      expectedSize: rp.size,
      id: `rp:${rp.id}`,
      targetPath: rp.targetPath
    });

    if (exists && onDiskHash === rp.sha256 && onDiskSize === rp.size) {
      entries.push({
        action: "KEEP",
        kind: "resourcePack",
        logicalId: rp.id,
        targetPath: rp.targetPath,
        expectedSha256: rp.sha256,
        expectedSize: rp.size,
        autoEnable: rp.autoEnable,
        reason: "rp_hash_match"
      });
    } else if (exists) {
      entries.push({
        action: "REPLACE",
        kind: "resourcePack",
        logicalId: rp.id,
        targetPath: rp.targetPath,
        expectedSha256: rp.sha256,
        expectedSize: rp.size,
        download,
        autoEnable: rp.autoEnable,
        reason: "rp_corrupt"
      });
    } else {
      entries.push({
        action: "DOWNLOAD",
        kind: "resourcePack",
        logicalId: rp.id,
        targetPath: rp.targetPath,
        expectedSha256: rp.sha256,
        expectedSize: rp.size,
        download,
        autoEnable: rp.autoEnable,
        reason: "rp_missing"
      });
    }
  }

  // --- Stale managed files (in state, not in new release) ---
  const currentTargets = new Set(entries.map((e) => e.targetPath));
  for (const managed of opts.state.files) {
    if (currentTargets.has(managed.targetPath)) continue;
    // Only delete if we previously managed it.
    entries.push({
      action: "DELETE_MANAGED",
      kind: managed.type,
      logicalId: managed.logicalId,
      targetPath: managed.targetPath,
      expectedSha256: managed.sha256,
      expectedSize: managed.size,
      reason: "stale_managed"
    });
  }

  // Unmanaged jars under mods/ are intentionally ignored (not DELETE).

  let finalEntries = entries;
  if (opts.http) {
    finalEntries = await enrichPackPlanDownloadSizes(entries, opts.http, opts.signal);
  }

  const summary = summarize(finalEntries);
  const plan: InstallationPlan = {
    dryRun,
    packVersion,
    releaseSequence: opts.resolved.candidate.releaseSequence,
    releaseSha256: opts.resolved.candidate.releaseSha256,
    manifestSha256,
    channel: opts.resolved.channel.descriptor.channel,
    productBase,
    entries: finalEntries,
    summary
  };

  const downloadPlan = summarizePlannedDownloadBytes(finalEntries);
  opts.emitter?.emit("PLAN_READY", {
    dryRun,
    summary: { ...summary },
    entryCount: entries.length,
    plannedDownloadBytes: downloadPlan.plannedDownloadBytes,
    hasUnknownDownloadSize: downloadPlan.hasUnknownDownloadSize,
    plannedDownloadFiles: downloadPlan.plannedDownloadFiles
  });

  return plan;
}

async function planConfig(
  cfg: ManifestConfig,
  targetPath: string,
  exists: boolean,
  abs: string,
  download: DownloadRequest
): Promise<PlanEntry> {
  // Hash-only for configs (no size in manifest): mark expectedSize as -1 for engine.
  const dl: DownloadRequest = { ...download, expectedSize: -1 };

  if (cfg.apply === "force") {
    if (!exists) {
      return {
        action: "DOWNLOAD",
        kind: "config",
        logicalId: cfg.path,
        targetPath,
        expectedSha256: cfg.sha256,
        expectedSize: -1,
        download: dl,
        policy: "force",
        reason: "force_missing"
      };
    }
    const h = await hashFileSha256Simple(abs);
    if (h.sha256 === cfg.sha256) {
      return {
        action: "KEEP",
        kind: "config",
        logicalId: cfg.path,
        targetPath,
        expectedSha256: cfg.sha256,
        expectedSize: h.size,
        policy: "force",
        reason: "force_identical"
      };
    }
    return {
      action: "REPLACE",
      kind: "config",
      logicalId: cfg.path,
      targetPath,
      expectedSha256: cfg.sha256,
      expectedSize: -1,
      download: dl,
      policy: "force",
      reason: "force_different"
    };
  }

  if (cfg.apply === "if_missing" || cfg.apply === "never_overwrite") {
    if (!exists) {
      return {
        action: "DOWNLOAD",
        kind: "config",
        logicalId: cfg.path,
        targetPath,
        expectedSha256: cfg.sha256,
        expectedSize: -1,
        download: dl,
        policy: cfg.apply,
        reason: cfg.apply === "if_missing" ? "if_missing_absent" : "never_overwrite_absent"
      };
    }
    return {
      action: "KEEP",
      kind: "config",
      logicalId: cfg.path,
      targetPath,
      expectedSha256: cfg.sha256,
      expectedSize: -1,
      policy: cfg.apply,
      reason: cfg.apply === "if_missing" ? "if_missing_preserved" : "never_overwrite_preserved"
    };
  }

  throw new LauncherError(ErrorCode.INVALID_CONFIG_POLICY, `unknown apply in plan`, { apply: cfg.apply });
}

function claimTarget(index: Map<string, string>, targetPath: string, logicalId: string): void {
  const prev = index.get(targetPath);
  if (prev !== undefined && prev !== logicalId) {
    throw new LauncherError(ErrorCode.PLAN_AMBIGUITY, `targetPath collision`, {
      targetPath,
      a: prev,
      b: logicalId
    });
  }
  index.set(targetPath, logicalId);
}

async function fileExists(abs: string): Promise<boolean> {
  try {
    await access(abs, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function summarize(entries: PlanEntry[]): PlanSummary {
  const s: PlanSummary = {
    download: 0,
    install: 0,
    replace: 0,
    keep: 0,
    deleteManaged: 0,
    skip: 0,
    verify: 0
  };
  for (const e of entries) {
    switch (e.action) {
      case "DOWNLOAD":
        s.download++;
        break;
      case "INSTALL":
        s.install++;
        break;
      case "REPLACE":
        s.replace++;
        break;
      case "KEEP":
        s.keep++;
        break;
      case "DELETE_MANAGED":
        s.deleteManaged++;
        break;
      case "SKIP":
        s.skip++;
        break;
      case "VERIFY":
        s.verify++;
        break;
    }
  }
  return s;
}

export function formatPlanSummaryHuman(summary: PlanSummary): string {
  return `${summary.download + summary.replace} fichiers à télécharger/réparer\n${summary.deleteManaged} fichiers managed obsolètes\n${summary.keep} fichiers déjà à jour`;
}
