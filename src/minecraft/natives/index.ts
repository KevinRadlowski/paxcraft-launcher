import { createInflateRaw } from "node:zlib";
import { mkdir, open, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import { isPathInside } from "../../instance/security/index.js";

export interface SecureExtractOptions {
  zipBytes: Buffer;
  destRoot: string;
  /** Path prefixes to skip (e.g. META-INF/) */
  excludePrefixes?: string[];
}

/**
 * Restrictive ZIP extractor for verified native archives only.
 * Supports STORE (0) and DEFLATE (8). Rejects Zip Slip and absolute paths.
 */
export async function extractZipSecure(opts: SecureExtractOptions): Promise<string[]> {
  const destRoot = path.resolve(opts.destRoot);
  await mkdir(destRoot, { recursive: true });
  const exclude = (opts.excludePrefixes ?? ["META-INF/"]).map((p) => p.replace(/\\/g, "/"));
  const written: string[] = [];

  let offset = 0;
  const buf = opts.zipBytes;

  while (offset + 30 <= buf.byteLength) {
    const sig = buf.readUInt32LE(offset);
    if (sig === 0x02014b50 || sig === 0x06054b50) {
      // central directory / end — stop local file scan
      break;
    }
    if (sig !== 0x04034b50) {
      throw new LauncherError(ErrorCode.NATIVE_EXTRACTION_FAILED, "invalid ZIP local header signature", {
        offset
      });
    }
    const method = buf.readUInt16LE(offset + 8);
    const compSize = buf.readUInt32LE(offset + 18);
    const uncompSize = buf.readUInt32LE(offset + 22);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + nameLen;
    if (nameEnd + extraLen + compSize > buf.byteLength) {
      throw new LauncherError(ErrorCode.NATIVE_EXTRACTION_FAILED, "ZIP entry truncated");
    }
    const name = buf.subarray(nameStart, nameEnd).toString("utf8");
    const dataStart = nameEnd + extraLen;
    const dataEnd = dataStart + compSize;
    const compressed = buf.subarray(dataStart, dataEnd);
    offset = dataEnd;

    const normalized = name.replace(/\\/g, "/");
    if (!normalized || normalized.endsWith("/")) {
      // directory entry
      continue;
    }
    if (exclude.some((p) => normalized === p || normalized.startsWith(p))) {
      continue;
    }
    assertSafeZipEntryName(normalized);

    const dest = path.resolve(destRoot, ...normalized.split("/"));
    if (!isPathInside(destRoot, dest)) {
      throw new LauncherError(ErrorCode.ZIP_SLIP_REFUSED, `Zip Slip refused: ${normalized}`, {
        entry: normalized
      });
    }

    let data: Buffer;
    if (method === 0) {
      data = Buffer.from(compressed);
    } else if (method === 8) {
      data = await inflateRaw(compressed, uncompSize);
    } else {
      throw new LauncherError(ErrorCode.NATIVE_EXTRACTION_FAILED, `unsupported ZIP method ${method}`, {
        entry: normalized
      });
    }
    if (uncompSize > 0 && data.byteLength !== uncompSize) {
      throw new LauncherError(ErrorCode.NATIVE_EXTRACTION_FAILED, "uncompressed size mismatch", {
        entry: normalized
      });
    }

    await mkdir(path.dirname(dest), { recursive: true });
    // Refuse writing if destination is somehow a reparse outside — basic write
    const handle = await open(dest, "w");
    try {
      await handle.writeFile(data);
    } finally {
      await handle.close();
    }
    written.push(normalized);
  }

  return written;
}

export function assertSafeZipEntryName(name: string): void {
  if (!name || name.includes("\0")) {
    throw new LauncherError(ErrorCode.ZIP_SLIP_REFUSED, "empty/null ZIP entry");
  }
  if (name.startsWith("/") || name.startsWith("\\") || /^[a-zA-Z]:/.test(name) || name.startsWith("//")) {
    throw new LauncherError(ErrorCode.ZIP_SLIP_REFUSED, `absolute ZIP entry refused: ${name}`);
  }
  if (name.includes("\\")) {
    throw new LauncherError(ErrorCode.ZIP_SLIP_REFUSED, `backslash ZIP entry refused: ${name}`);
  }
  const parts = name.split("/");
  if (parts.some((p) => p === ".." || p === "")) {
    throw new LauncherError(ErrorCode.ZIP_SLIP_REFUSED, `traversal ZIP entry refused: ${name}`);
  }
}

async function inflateRaw(compressed: Buffer, maxSize: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  const inflate = createInflateRaw();
  await pipeline(
    Readable.from([compressed]),
    inflate,
    async function (source) {
      for await (const chunk of source) {
        const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
        total += b.byteLength;
        if (maxSize > 0 && total > maxSize + 64) {
          throw new LauncherError(ErrorCode.NATIVE_EXTRACTION_FAILED, "inflate exceeded declared size");
        }
        chunks.push(b);
      }
    }
  );
  return Buffer.concat(chunks);
}

void writeFile;
