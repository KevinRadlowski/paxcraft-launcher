import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";

/**
 * Windows-aware atomic replace:
 * 1. write to temp in same directory
 * 2. optional fsync via FileHandle
 * 3. rename over destination (Node fsPromises.rename replaces on Windows when dest exists for files)
 *
 * Limits: antivirus may lock files briefly; EBUSY/EPERM → FILE_LOCKED (caller may retry once).
 * Long paths: prefer \\?\ only if needed later; callers should keep paths under MAX_PATH when possible.
 */
export async function writeFileAtomic(destPath: string, data: string | Buffer): Promise<void> {
  const dir = path.dirname(destPath);
  await mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(destPath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    const handle = await open(tmp, "w");
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await replaceFile(tmp, destPath);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw mapFsError(e, destPath);
  }
}

export async function replaceFile(fromPath: string, toPath: string): Promise<void> {
  try {
    await rename(fromPath, toPath);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    // Windows: if dest exists and rename fails, try unlink then rename.
    if (code === "EEXIST" || code === "EPERM" || code === "EACCES" || code === "EBUSY") {
      try {
        await unlink(toPath);
        await rename(fromPath, toPath);
        return;
      } catch (e2) {
        throw mapFsError(e2, toPath);
      }
    }
    throw mapFsError(e, toPath);
  }
}

export function mapFsError(e: unknown, filePath: string): LauncherError {
  if (LauncherError.isLauncherError(e)) return e;
  const code = (e as NodeJS.ErrnoException).code;
  if (code === "EBUSY" || code === "EPERM" || code === "EACCES") {
    return new LauncherError(ErrorCode.FILE_LOCKED, `file locked or inaccessible: ${filePath}`, {
      path: filePath,
      errno: code
    });
  }
  return new LauncherError(ErrorCode.INTERNAL_ERROR, e instanceof Error ? e.message : String(e), {
    path: filePath,
    errno: code
  });
}

export async function hashFileSha256(filePath: string): Promise<{ sha256: string; size: number }> {
  const hash = createHash("sha256");
  let size = 0;
  await pipeline(
    createReadStream(filePath),
    async function* (source) {
      for await (const chunk of source) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buf.byteLength;
        hash.update(buf);
        yield buf;
      }
    },
    async function (source) {
      for await (const _ of source) {
        // drain
      }
    }
  );
  return { sha256: hash.digest("hex"), size };
}

/** Stream-hash a file without loading it fully into RAM (simple read). */
export async function hashFileSha256Simple(filePath: string): Promise<{ sha256: string; size: number }> {
  const hash = createHash("sha256");
  let size = 0;
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buf.byteLength;
    hash.update(buf);
  }
  return { sha256: hash.digest("hex"), size };
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function cleanupTemp(filePath: string): Promise<void> {
  await rm(filePath, { force: true }).catch(() => undefined);
}

export { writeFile, createWriteStream, createReadStream };
