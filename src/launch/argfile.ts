import { randomUUID } from "node:crypto";
import { lstat, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ErrorCode, LauncherError } from "../core/errors/index.js";
import { ensureDir } from "../download/fs/index.js";
import { escapeJavaArgfileLine } from "./argfileEscape.js";

/**
 * Logical plan to materialize a Java @argfile at spawn time.
 * Must NOT be written during buildLaunchSpec / prepareLaunch / dry-run.
 *
 * LIMITATION (documented): when required, the file briefly contains resolved
 * gameArgs including auth_access_token for the duration of the game process only.
 * POSIX mode 0o600 is best-effort; on Windows it does NOT provide a strong ACL.
 */
export interface ArgfilePlan {
  readonly required: true;
  /** Absolute validated launcher tmp directory (under runtime root). */
  readonly tmpRoot: string;
  /** Absolute runtime root used for path containment checks. */
  readonly runtimeRoot: string;
  /** Lines to write (may include secrets). Never log. */
  readonly lines: readonly string[];
}

export interface MaterializedLaunchArguments {
  /** Argv passed to spawn (either logical argv or ["@path"]). */
  readonly spawnArgv: readonly string[];
  /** Present only when an argfile was written. */
  readonly argfilePath?: string;
  /** Best-effort delete; never logs file contents or secrets. */
  cleanup(): Promise<ArgfileCleanupResult>;
}

export interface ArgfileCleanupResult {
  cleaned: boolean;
  /** Structured failure without token / file contents. */
  error?: LauncherError;
}

/**
 * Write argfile immediately before spawn when planned.
 * Path: launch-args-<pid>-<uuid>.txt under validated tmpRoot.
 */
export async function materializeLaunchArguments(opts: {
  logicalArgv: readonly string[];
  argfilePlan?: ArgfilePlan;
}): Promise<MaterializedLaunchArguments> {
  if (!opts.argfilePlan) {
    return {
      spawnArgv: opts.logicalArgv,
      async cleanup() {
        return { cleaned: true };
      }
    };
  }

  const plan = opts.argfilePlan;
  assertSafeTmpRoot(plan.tmpRoot, plan.runtimeRoot);
  await ensureDir(plan.tmpRoot);

  const fileName = `launch-args-${process.pid}-${randomUUID()}.txt`;
  const argfilePath = path.join(plan.tmpRoot, fileName);
  assertUnderRoot(argfilePath, plan.tmpRoot);
  await assertNotSymlinkEscape(plan.tmpRoot, plan.runtimeRoot);

  await writeFile(argfilePath, plan.lines.map(escapeJavaArgfileLine).join("\n") + "\n", {
    encoding: "utf8",
    mode: 0o600
  });

  let cleaned = false;
  return {
    spawnArgv: Object.freeze([`@${argfilePath}`]),
    argfilePath,
    async cleanup(): Promise<ArgfileCleanupResult> {
      if (cleaned) return { cleaned: true };
      try {
        await rm(argfilePath, { force: true });
        cleaned = true;
        return { cleaned: true };
      } catch (e) {
        const err = new LauncherError(
          ErrorCode.ARGFILE_CLEANUP_FAILED,
          "failed to remove launch argfile",
          {
            // path only — never contents; basename is uuid (no token)
            argfileName: path.basename(argfilePath),
            cause: e instanceof Error ? e.message : String(e)
          }
        );
        return { cleaned: false, error: err };
      }
    }
  };
}

function assertSafeTmpRoot(tmpRoot: string, runtimeRoot: string): void {
  if (!tmpRoot || tmpRoot.includes("://") || tmpRoot.startsWith("//")) {
    throw new LauncherError(ErrorCode.UNSAFE_PATH, "argfile tmpRoot must be local");
  }
  assertUnderRoot(tmpRoot, runtimeRoot);
}

function assertUnderRoot(abs: string, root: string): void {
  const resolved = path.resolve(abs);
  const rootResolved = path.resolve(root);
  const rel = path.relative(rootResolved, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new LauncherError(ErrorCode.UNSAFE_PATH, "path escapes allowed root", {
      // omit full paths that might leak env in some setups — keep relative check only
      escaped: true
    });
  }
}

async function assertNotSymlinkEscape(tmpRoot: string, runtimeRoot: string): Promise<void> {
  try {
    const st = await lstat(tmpRoot);
    if (st.isSymbolicLink()) {
      // Resolve and re-check containment of the link target's parent chain via realpath would be ideal;
      // fail closed on symlink tmp for this lot.
      throw new LauncherError(ErrorCode.SYMLINK_ESCAPE, "argfile tmp must not be a symlink", {});
    }
  } catch (e) {
    if (LauncherError.isLauncherError(e)) throw e;
    // missing dir is OK — ensureDir creates it
  }
  void runtimeRoot;
}
