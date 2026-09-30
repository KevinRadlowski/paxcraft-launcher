import { ErrorCode, LauncherError } from "../core/errors/index.js";
import type { RuntimeAuditFinding } from "../minecraft/audit/index.js";
import type { LaunchIdentity } from "./identity.js";
import { validateLaunchIdentity } from "./identity.js";
import { validateMainClass } from "./classpath.js";
import type { DiscoveredJava } from "../java/requirements/index.js";
import type { ResolvedMinecraftRuntime } from "../minecraft/fabric/index.js";
import { isJavaCompatible, pickCompatibleJava } from "../java/requirements/index.js";
import path from "node:path";

export interface LaunchReadinessResult {
  ready: boolean;
  reasons: Array<{ code: string; detail: string }>;
}

/**
 * Pre-launch gate: refuse spawn when instance/runtime/java/identity are not ready.
 */
export function validateLaunchReadiness(opts: {
  runtimeFindings: RuntimeAuditFinding[];
  /** Instance audit findings with status-like fields; any CORRUPT/MISSING critical → refuse. */
  instanceFindings?: Array<{ status: string; id?: string }>;
  runtime: ResolvedMinecraftRuntime;
  java: DiscoveredJava | null;
  identity: LaunchIdentity;
  instanceRoot: string;
}): LaunchReadinessResult {
  const reasons: LaunchReadinessResult["reasons"] = [];

  try {
    validateLaunchIdentity(opts.identity);
  } catch (e) {
    reasons.push({
      code: LauncherError.isLauncherError(e) ? e.code : ErrorCode.INVALID_LAUNCH_IDENTITY,
      detail: "identity invalid"
    });
  }

  try {
    validateMainClass(opts.runtime.mainClass);
  } catch {
    reasons.push({ code: ErrorCode.INVALID_MAIN_CLASS, detail: "mainClass invalid" });
  }

  if (!opts.instanceRoot?.trim() || opts.instanceRoot.includes("\0")) {
    reasons.push({ code: ErrorCode.INSTANCE_ROOT_REQUIRED, detail: "instanceRoot invalid" });
  } else {
    const resolved = path.resolve(opts.instanceRoot);
    // Never implicit .minecraft — caller must pass explicit root; we only check non-empty.
    void resolved;
  }

  for (const f of opts.runtimeFindings) {
    if (f.status === "MISSING" || f.status === "CORRUPT" || f.status === "INVALID_METADATA") {
      // EXTRACT_NATIVE plan entries aren't in audit the same way — treat missing/corrupt artefacts as not ready
      if (f.id === "runtime-state") continue;
      reasons.push({ code: ErrorCode.LAUNCH_NOT_READY, detail: `runtime ${f.status}: ${f.id}` });
    }
    if (f.status === "MISSING_JAVA") {
      reasons.push({ code: ErrorCode.MISSING_JAVA, detail: "java missing" });
    }
    if (f.status === "INCOMPATIBLE_JAVA") {
      reasons.push({ code: ErrorCode.INCOMPATIBLE_JAVA, detail: "java incompatible" });
    }
  }

  if (opts.instanceFindings) {
    for (const f of opts.instanceFindings) {
      if (f.status === "CORRUPT" || f.status === "MISSING") {
        reasons.push({
          code: ErrorCode.LAUNCH_NOT_READY,
          detail: `instance ${f.status}: ${f.id ?? "?"}`
        });
      }
    }
  }

  if (!opts.java) {
    reasons.push({ code: ErrorCode.MISSING_JAVA, detail: "no java installation" });
  } else if (opts.runtime.javaRequirement) {
    try {
      pickCompatibleJava([opts.java], opts.runtime.javaRequirement);
    } catch (e) {
      if (LauncherError.isLauncherError(e)) {
        reasons.push({ code: e.code, detail: "java requirement failed" });
      } else {
        reasons.push({ code: ErrorCode.INCOMPATIBLE_JAVA, detail: "java requirement failed" });
      }
    }
  }

  return { ready: reasons.length === 0, reasons };
}

export function assertLaunchReady(result: LaunchReadinessResult): void {
  if (!result.ready) {
    throw new LauncherError(ErrorCode.LAUNCH_NOT_READY, "launch readiness failed", {
      reasons: result.reasons
    });
  }
}

void isJavaCompatible;
