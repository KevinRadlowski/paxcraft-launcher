import type { InstallationPlan } from "../../instance/plan/index.js";
import type { TrustedResolvedRelease } from "../../core/resolve/index.js";
import { buildInstallationPlan } from "../../instance/plan/index.js";
import { InstancePaths } from "../../instance/layout/index.js";
import { InstanceStateStore } from "../../instance/state/instanceState.js";
import type { ProgressEmitter } from "../../instance/events/index.js";

/** Deterministic pack plan against a TrustedResolvedRelease (no mutation). */
export async function planPackOperation(opts: {
  resolved: TrustedResolvedRelease;
  instancePath: string;
  emitter?: ProgressEmitter;
}): Promise<InstallationPlan> {
  const paths = new InstancePaths(opts.instancePath);
  const state = await new InstanceStateStore(paths).load();
  return buildInstallationPlan({
    resolved: opts.resolved,
    state,
    paths,
    dryRun: true,
    ...(opts.emitter ? { emitter: opts.emitter } : {})
  });
}
