import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import type { TrustedResolvedRelease } from "../../core/resolve/index.js";
import { hashFileSha256Simple } from "../../download/fs/index.js";
import type { InstancePaths } from "../layout/index.js";
import { ProgressEmitter } from "../events/index.js";
import { buildInstallationPlan, type InstallationPlan } from "../plan/index.js";
import { InstanceStateStore, type InstanceState, type ManagedFileRecord } from "../state/instanceState.js";
import { resolveSafeInstancePath } from "../security/index.js";

export type AuditStatus =
  | "OK"
  | "MISSING"
  | "CORRUPT"
  | "PRESERVED"
  | "UNMANAGED"
  | "STALE_MANAGED";

export interface AuditFinding {
  status: AuditStatus;
  kind: "mod" | "config" | "resourcePack" | "unknown";
  logicalId: string | null;
  targetPath: string;
  expectedSha256?: string;
  actualSha256?: string;
  policy?: string;
}

export interface AuditReport {
  findings: AuditFinding[];
  state: InstanceState;
}

/**
 * Classify instance files against trusted release + managed state.
 * Unmanaged jars under mods/ are reported but never deleted by repair.
 */
export async function auditInstance(opts: {
  resolved: TrustedResolvedRelease;
  paths: InstancePaths;
  emitter?: ProgressEmitter;
}): Promise<AuditReport> {
  const emitter = opts.emitter ?? new ProgressEmitter();
  emitter.emit("AUDIT_STARTED", {});

  const stateStore = new InstanceStateStore(opts.paths);
  const state = await stateStore.load();
  const plan = await buildInstallationPlan({
    resolved: opts.resolved,
    state,
    paths: opts.paths,
    dryRun: true,
    emitter
  });

  const findings: AuditFinding[] = [];
  const managedTargets = new Set(state.files.map((f) => f.targetPath));

  for (const entry of plan.entries) {
    if (entry.action === "DELETE_MANAGED") {
      findings.push({
        status: "STALE_MANAGED",
        kind: entry.kind,
        logicalId: entry.logicalId,
        targetPath: entry.targetPath,
        expectedSha256: entry.expectedSha256
      });
      continue;
    }
    if (entry.action === "KEEP") {
      const preserved =
        entry.reason === "if_missing_preserved" || entry.reason === "never_overwrite_preserved";
      const finding: AuditFinding = {
        status: preserved ? "PRESERVED" : "OK",
        kind: entry.kind,
        logicalId: entry.logicalId,
        targetPath: entry.targetPath,
        expectedSha256: entry.expectedSha256
      };
      if (entry.policy) finding.policy = entry.policy;
      findings.push(finding);
      continue;
    }
    if (entry.action === "DOWNLOAD") {
      const finding: AuditFinding = {
        status: "MISSING",
        kind: entry.kind,
        logicalId: entry.logicalId,
        targetPath: entry.targetPath,
        expectedSha256: entry.expectedSha256
      };
      if (entry.policy) finding.policy = entry.policy;
      findings.push(finding);
      continue;
    }
    if (entry.action === "REPLACE") {
      const finding: AuditFinding = {
        status: "CORRUPT",
        kind: entry.kind,
        logicalId: entry.logicalId,
        targetPath: entry.targetPath,
        expectedSha256: entry.expectedSha256
      };
      if (entry.policy) finding.policy = entry.policy;
      findings.push(finding);
    }
  }

  // Scan mods/ for unmanaged jars (not in managed state and not in plan targets).
  const planTargets = new Set(plan.entries.map((e) => e.targetPath));
  try {
    const { readdir } = await import("node:fs/promises");
    const names = await readdir(opts.paths.modsDir());
    for (const name of names) {
      if (!name.endsWith(".jar")) continue;
      const targetPath = `mods/${name}`;
      if (planTargets.has(targetPath) || managedTargets.has(targetPath)) continue;
      findings.push({
        status: "UNMANAGED",
        kind: "unknown",
        logicalId: null,
        targetPath
      });
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new LauncherError(ErrorCode.INTERNAL_ERROR, "failed to scan mods/", {
        cause: e instanceof Error ? e.message : String(e)
      });
    }
  }

  emitter.emit("AUDIT_COMPLETE", { findingCount: findings.length });
  return { findings, state };
}

/**
 * Repair uses the same plan rules as install (no guessed repairs).
 */
export async function planRepair(opts: {
  resolved: TrustedResolvedRelease;
  paths: InstancePaths;
  emitter?: ProgressEmitter;
}): Promise<InstallationPlan> {
  const emitter = opts.emitter ?? new ProgressEmitter();
  emitter.emit("REPAIR_STARTED", {});
  const stateStore = new InstanceStateStore(opts.paths);
  const state = await stateStore.load();
  const plan = await buildInstallationPlan({
    resolved: opts.resolved,
    state,
    paths: opts.paths,
    dryRun: true,
    emitter
  });
  emitter.emit("REPAIR_COMPLETE", { summary: { ...plan.summary } });
  return plan;
}

/** Verify a single managed record on disk (helper). */
export async function verifyManagedFile(
  paths: InstancePaths,
  record: ManagedFileRecord
): Promise<"OK" | "MISSING" | "CORRUPT"> {
  const abs = await resolveSafeInstancePath(paths, record.targetPath);
  try {
    await access(abs, fsConstants.F_OK);
  } catch {
    return "MISSING";
  }
  const h = await hashFileSha256Simple(abs);
  if (h.sha256 !== record.sha256) return "CORRUPT";
  if (record.size > 0 && h.size !== record.size) return "CORRUPT";
  return "OK";
}
