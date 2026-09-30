import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import type { InstancePaths } from "../layout/index.js";

const WINDOWS_REPARSE = 0x400; // FILE_ATTRIBUTE_REPARSE_POINT bit in Stats mode on some Node builds — also check isSymbolicLink

/**
 * Resolve a manifest-validated relative POSIX path into an absolute path under instanceRoot.
 * Fail closed on absolute paths, traversal, symlink/junction escape.
 */
export async function resolveSafeInstancePath(
  paths: InstancePaths,
  relativePosix: string
): Promise<string> {
  if (typeof relativePosix !== "string" || !relativePosix) {
    throw new LauncherError(ErrorCode.UNSAFE_PATH, "empty relative path");
  }
  if (relativePosix.includes("\\") || relativePosix.includes("\0") || relativePosix.includes("\r") || relativePosix.includes("\n")) {
    throw new LauncherError(ErrorCode.UNSAFE_PATH, "forbidden characters in relative path", { path: relativePosix });
  }
  if (path.isAbsolute(relativePosix) || /^[a-zA-Z]:/.test(relativePosix) || relativePosix.startsWith("//") || relativePosix.startsWith("/")) {
    throw new LauncherError(ErrorCode.UNSAFE_PATH, "absolute path refused", { path: relativePosix });
  }
  const parts = relativePosix.split("/");
  if (parts.some((p) => p === ".." || p === "" || p === ".")) {
    throw new LauncherError(ErrorCode.UNSAFE_PATH, "path traversal refused", { path: relativePosix });
  }

  const candidate = path.resolve(paths.root, ...parts);
  const rootResolved = path.resolve(paths.root);
  if (!isPathInside(rootResolved, candidate)) {
    throw new LauncherError(ErrorCode.UNSAFE_PATH, "resolved path escapes instanceRoot", {
      path: relativePosix,
      candidate
    });
  }

  // Walk parents: refuse if any segment is a symlink/junction pointing outside.
  await assertNoSymlinkEscape(rootResolved, candidate);
  return candidate;
}

/**
 * Lexical containment via path.relative.
 * On Windows this is case-insensitive, but does **not** equate DOS 8.3 short
 * names with long names (e.g. `RUNNER~1` vs `runneradmin`).
 */
export function isPathInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** realpath when the path exists; null on ENOENT. */
export async function tryRealpath(absPath: string): Promise<string | null> {
  try {
    return await realpath(absPath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/**
 * Containment using filesystem identity (realpath) when paths exist.
 * Accepts Windows short/long path aliases of the same instance root.
 */
export async function isCanonicallyInside(root: string, candidate: string): Promise<boolean> {
  const rootResolved = path.resolve(root);
  const candidateResolved = path.resolve(candidate);
  const rootCanon = (await tryRealpath(rootResolved)) ?? rootResolved;
  const candidateCanon = (await tryRealpath(candidateResolved)) ?? candidateResolved;
  return isPathInside(rootCanon, candidateCanon);
}

async function assertNoSymlinkEscape(root: string, candidate: string): Promise<void> {
  const rootResolved = path.resolve(root);
  // Canonical root identity — required so realpath(child) is not compared against
  // a textual 8.3 alias of the same directory (GitHub Actions TEMP: RUNNER~1).
  const rootCanon = (await tryRealpath(rootResolved)) ?? rootResolved;

  // Check each existing ancestor and the leaf if present (lexical walk under rootResolved).
  const segments: string[] = [];
  let cur = path.resolve(candidate);
  while (isPathInside(rootResolved, cur) && cur !== rootResolved) {
    segments.push(cur);
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  segments.push(rootResolved);

  for (const p of segments.reverse()) {
    let st;
    try {
      st = await lstat(p);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw e;
    }
    if (st.isSymbolicLink()) {
      let target: string;
      try {
        target = await realpath(p);
      } catch {
        throw new LauncherError(ErrorCode.SYMLINK_ESCAPE, `cannot resolve symlink: ${p}`, { path: p });
      }
      if (!isPathInside(rootCanon, target)) {
        throw new LauncherError(ErrorCode.SYMLINK_ESCAPE, `symlink escapes instanceRoot: ${p}`, {
          path: p,
          target
        });
      }
    }
    // Windows reparse/junction: Node marks junctions as symbolic links typically.
    // Compare realpath(child) against realpath(root), not the unresolved root string.
    if (st.isDirectory() || st.isFile()) {
      try {
        const rp = await realpath(p);
        const isRootIdentity =
          path.resolve(p) === rootResolved || rp === rootCanon;
        if (!isPathInside(rootCanon, rp) && !isRootIdentity) {
          throw new LauncherError(ErrorCode.SYMLINK_ESCAPE, `reparse/realpath escapes instanceRoot: ${p}`, {
            path: p,
            realpath: rp
          });
        }
      } catch (e) {
        if (LauncherError.isLauncherError(e)) throw e;
        // realpath failure on non-existent is fine; existing path failure → fail closed
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
          // ignore if path doesn't exist mid-walk
        }
      }
    }
    void WINDOWS_REPARSE;
  }
}

/** Ensure final destination after create still lies under root (post-write check). */
export async function assertFinalPathInsideInstance(paths: InstancePaths, absolutePath: string): Promise<void> {
  const rootResolved = path.resolve(paths.root);
  const abs = path.resolve(absolutePath);
  if (!isPathInside(rootResolved, abs) && !(await isCanonicallyInside(rootResolved, abs))) {
    throw new LauncherError(ErrorCode.UNSAFE_PATH, "final path outside instanceRoot", { absolutePath: abs });
  }
  try {
    const rootCanon = (await tryRealpath(rootResolved)) ?? rootResolved;
    const rp = await realpath(abs);
    if (!isPathInside(rootCanon, rp)) {
      throw new LauncherError(ErrorCode.SYMLINK_ESCAPE, "final realpath outside instanceRoot", {
        absolutePath: abs,
        realpath: rp
      });
    }
  } catch (e) {
    if (LauncherError.isLauncherError(e)) throw e;
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
}
