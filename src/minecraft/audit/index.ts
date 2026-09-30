import type { RuntimeInstallationPlan } from "../runtime/types.js";
import { buildRuntimeInstallationPlan, type BuildRuntimePlanOptions } from "../runtime/plan.js";
import type { DiscoveredJava } from "../../java/requirements/index.js";
import { pickCompatibleJava } from "../../java/requirements/index.js";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";

export type RuntimeAuditStatus =
  | "OK"
  | "MISSING"
  | "CORRUPT"
  | "INVALID_METADATA"
  | "MISSING_JAVA"
  | "INCOMPATIBLE_JAVA";

export interface RuntimeAuditFinding {
  status: RuntimeAuditStatus;
  id: string;
  relativePath?: string;
  detail?: string;
}

export async function auditRuntime(opts: BuildRuntimePlanOptions & {
  discoveredJava?: DiscoveredJava[];
}): Promise<{ findings: RuntimeAuditFinding[]; plan: RuntimeInstallationPlan }> {
  opts.emitter?.emit("AUDIT_STARTED", {});
  const plan = await buildRuntimeInstallationPlan({ ...opts, dryRun: true });
  const findings: RuntimeAuditFinding[] = [];

  for (const e of plan.entries) {
    if (e.action === "KEEP") {
      findings.push({ status: "OK", id: e.id, relativePath: e.relativePath });
    } else if (e.action === "DOWNLOAD") {
      findings.push({ status: "MISSING", id: e.id, relativePath: e.relativePath });
    } else if (e.action === "REPAIR") {
      findings.push({ status: "CORRUPT", id: e.id, relativePath: e.relativePath });
    }
  }

  if (plan.javaRequirement) {
    if (!opts.discoveredJava || opts.discoveredJava.length === 0) {
      findings.push({ status: "MISSING_JAVA", id: "java", detail: `need major>=${plan.javaRequirement.majorVersion}` });
    } else {
      try {
        pickCompatibleJava(opts.discoveredJava, plan.javaRequirement);
        findings.push({ status: "OK", id: "java" });
      } catch (e) {
        if (LauncherError.isLauncherError(e) && e.code === ErrorCode.INCOMPATIBLE_JAVA) {
          findings.push({ status: "INCOMPATIBLE_JAVA", id: "java" });
        } else if (LauncherError.isLauncherError(e) && e.code === ErrorCode.MISSING_JAVA) {
          findings.push({ status: "MISSING_JAVA", id: "java" });
        } else {
          throw e;
        }
      }
    }
  }

  opts.emitter?.emit("AUDIT_COMPLETE", { findingCount: findings.length });
  return { findings, plan };
}

export async function planRuntimeRepair(opts: BuildRuntimePlanOptions): Promise<RuntimeInstallationPlan> {
  opts.emitter?.emit("REPAIR_STARTED", {});
  const plan = await buildRuntimeInstallationPlan({ ...opts, dryRun: true });
  opts.emitter?.emit("REPAIR_COMPLETE", { summary: { ...plan.summary } });
  return plan;
}
