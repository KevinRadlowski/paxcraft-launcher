import path from "node:path";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import {
  buildInstancePathGuardContext,
  validateInstancePathCandidate
} from "../paths/instanceLocation.js";
import {
  resolveCompleteUninstallDeleteMode,
  type CompleteUninstallDeleteMode
} from "../ownership/index.js";
import { defaultRuntimeRoot } from "../paths/productData.js";
import type { InstancePaths } from "../layout/index.js";

export interface CompleteUninstallContext {
  readonly canonicalInstanceRoot: string;
  readonly launcherDataRoot: string;
  readonly productUserDataRoot: string;
  readonly runtimeRoot: string;
}

export function resolveCompleteUninstallContext(
  launcherDataRoot: string,
  canonicalInstanceRoot: string
): CompleteUninstallContext {
  const dataDir = path.resolve(launcherDataRoot);
  return {
    canonicalInstanceRoot: path.resolve(canonicalInstanceRoot),
    launcherDataRoot: dataDir,
    productUserDataRoot: path.resolve(dataDir, ".."),
    runtimeRoot: path.resolve(defaultRuntimeRoot(dataDir))
  };
}

function isFilesystemRoot(candidate: string): boolean {
  const parsed = path.parse(candidate);
  return candidate === parsed.root || parsed.root === candidate;
}

export interface CompleteUninstallGuardResult {
  readonly deleteMode: CompleteUninstallDeleteMode;
}

/**
 * Fail closed before recursive instance deletion.
 * Proves target === configured root AND ownership marker when non-empty.
 */
export function assertCompleteUninstallTarget(
  paths: InstancePaths,
  ctx: CompleteUninstallContext
): CompleteUninstallGuardResult {
  const root = path.resolve(paths.root);
  const canonical = path.resolve(ctx.canonicalInstanceRoot);
  if (root !== canonical) {
    throw new LauncherError(ErrorCode.UNSAFE_PATH, "instance root is not canonical SweetCraft instance", {
      expected: canonical
    });
  }

  if (isFilesystemRoot(root)) {
    throw new LauncherError(ErrorCode.UNSAFE_PATH, "refusing to delete filesystem root");
  }

  const guard = buildInstancePathGuardContext(ctx.launcherDataRoot, ctx.productUserDataRoot);
  const validation = validateInstancePathCandidate(root, guard);
  if (!validation.ok) {
    throw new LauncherError(ErrorCode.UNSAFE_PATH, "refusing to delete protected launcher root", {
      reason: validation.reason
    });
  }

  const forbiddenRoots = [
    path.resolve(ctx.launcherDataRoot),
    path.resolve(ctx.productUserDataRoot),
    path.resolve(ctx.runtimeRoot),
    path.join(ctx.launcherDataRoot, "instances"),
    path.join(ctx.launcherDataRoot, "secure"),
    path.join(ctx.launcherDataRoot, "state")
  ];
  for (const forbidden of forbiddenRoots) {
    if (root === forbidden) {
      throw new LauncherError(ErrorCode.UNSAFE_PATH, "refusing to delete protected launcher root", {
        forbidden
      });
    }
  }

  const deleteMode = resolveCompleteUninstallDeleteMode(root);
  return { deleteMode };
}
