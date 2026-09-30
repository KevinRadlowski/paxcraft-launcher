import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { finished } from "node:stream/promises";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import { assertIntegrityExpectation, type IntegrityExpectation } from "../../minecraft/integrity/index.js";
import { cleanupTemp } from "../fs/index.js";
import type { ProgressEmitter } from "../../instance/events/index.js";
import { isRetryableDownloadError } from "./retry.js";
import type { ByteSource, DownloadRequest, DownloadResult } from "./types.js";

export interface DownloadEngineOptions {
  source: ByteSource;
  tmpDir: string;
  emitter?: ProgressEmitter;
  maxRetries?: number;
  /** Coalesce high-frequency DOWNLOAD_PROGRESS emissions (default 100ms ≈ 10/s). */
  minProgressEmitIntervalMs?: number;
  now?: () => number;
}

interface PendingProgressEmit {
  id: string;
  bytesReceived: number;
  expectedSize: number;
}

export function resolveRequestIntegrity(request: DownloadRequest): IntegrityExpectation {
  if (request.integrity) {
    return assertIntegrityExpectation(request.integrity);
  }
  if (typeof request.expectedSha256 === "string" && request.expectedSha256) {
    return assertIntegrityExpectation({ algorithm: "sha256", digest: request.expectedSha256 });
  }
  throw new LauncherError(ErrorCode.DOWNLOAD_HASH_MISMATCH, "download request missing integrity", {
    id: request.id
  });
}

/**
 * Streams downloads to temp files, hashing during the stream.
 * Supports sha256 (SweetCraft) and sha1 (official Minecraft artefacts).
 * Final path is only exposed after size + digest validation.
 */
export class DownloadEngine {
  private readonly source: ByteSource;
  private readonly tmpDir: string;
  private readonly emitter?: ProgressEmitter;
  private readonly maxRetries: number;
  private readonly minProgressEmitIntervalMs: number;
  private readonly now: () => number;
  private lastProgressEmitAt = 0;
  private pendingProgress: PendingProgressEmit | null = null;

  constructor(opts: DownloadEngineOptions) {
    this.source = opts.source;
    this.tmpDir = opts.tmpDir;
    if (opts.emitter) this.emitter = opts.emitter;
    this.maxRetries = opts.maxRetries ?? 2;
    this.minProgressEmitIntervalMs = opts.minProgressEmitIntervalMs ?? 100;
    this.now = opts.now ?? (() => Date.now());
  }

  private emitDownloadProgress(force: boolean, payload: PendingProgressEmit): void {
    if (!this.emitter) return;
    this.pendingProgress = payload;
    const t = this.now();
    if (force || t - this.lastProgressEmitAt >= this.minProgressEmitIntervalMs) {
      this.emitter.emit("DOWNLOAD_PROGRESS", { ...this.pendingProgress });
      this.lastProgressEmitAt = t;
      this.pendingProgress = null;
    }
  }

  private flushDownloadProgress(): void {
    if (!this.emitter || !this.pendingProgress) return;
    this.emitter.emit("DOWNLOAD_PROGRESS", { ...this.pendingProgress });
    this.lastProgressEmitAt = this.now();
    this.pendingProgress = null;
  }

  async download(request: DownloadRequest, signal?: AbortSignal): Promise<DownloadResult> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.downloadOnce(request, signal);
      } catch (e) {
        if (!LauncherError.isLauncherError(e)) throw e;
        if (e.code === ErrorCode.DOWNLOAD_ABORTED) throw e;
        if (!isRetryableDownloadError(e) || attempt >= this.maxRetries) throw e;
        attempt++;
      }
    }
  }

  private async downloadOnce(request: DownloadRequest, signal?: AbortSignal): Promise<DownloadResult> {
    const integrity = resolveRequestIntegrity(request);
    await mkdir(this.tmpDir, { recursive: true });
    const tempPath = path.join(
      this.tmpDir,
      `${sanitizeId(request.id)}.${process.pid}.${Date.now()}.${randomUUID()}.part`
    );

    this.lastProgressEmitAt = 0;
    this.pendingProgress = null;

    this.emitter?.emit("DOWNLOAD_STARTED", {
      id: request.id,
      url: request.url,
      targetPath: request.targetPath,
      expectedSize: request.expectedSize,
      algorithm: integrity.algorithm
    });

    try {
      if (signal?.aborted) {
        throw new LauncherError(ErrorCode.DOWNLOAD_ABORTED, "download aborted before start", {
          id: request.id
        });
      }

      const openOpts: { signal?: AbortSignal; timeoutMs: number } = {
        timeoutMs: request.timeoutMs
      };
      if (signal) openOpts.signal = signal;
      const { stream, contentLength } = await this.source.open(request.url, openOpts);

      if (contentLength !== null) {
        if (request.expectedSize >= 0 && contentLength !== request.expectedSize) {
          throw new LauncherError(ErrorCode.DOWNLOAD_SIZE_MISMATCH, "Content-Length != expected size", {
            id: request.id,
            contentLength,
            expectedSize: request.expectedSize
          });
        }
        if (contentLength > request.maxBytes) {
          throw new LauncherError(ErrorCode.METADATA_TOO_LARGE, "Content-Length exceeds maxBytes", {
            contentLength,
            maxBytes: request.maxBytes
          });
        }
      }

      const hash = createHash(integrity.algorithm);
      let size = 0;
      const out = createWriteStream(tempPath);
      // Intentional destroy on failure must not surface as an unhandled 'error'
      // (Node may emit ERR_STREAM_DESTROYED asynchronously — flakes test runners).
      const silenceWriteStreamErrors = (): void => {
        out.removeAllListeners("error");
        out.on("error", () => undefined);
      };

      try {
        for await (const chunk of stream) {
          if (signal?.aborted) {
            throw new LauncherError(ErrorCode.DOWNLOAD_ABORTED, "download aborted", { id: request.id });
          }
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buf.byteLength;
          if (size > request.maxBytes) {
            throw new LauncherError(ErrorCode.METADATA_TOO_LARGE, "stream exceeded maxBytes", {
              size,
              maxBytes: request.maxBytes
            });
          }
          hash.update(buf);
          if (!out.write(buf)) {
            await new Promise<void>((resolve, reject) => {
              const onDrain = (): void => {
                cleanup();
                resolve();
              };
              const onError = (err: Error): void => {
                cleanup();
                reject(err);
              };
              const cleanup = (): void => {
                out.off("drain", onDrain);
                out.off("error", onError);
              };
              out.once("drain", onDrain);
              out.once("error", onError);
            });
          }
          this.emitDownloadProgress(false, {
            id: request.id,
            bytesReceived: size,
            expectedSize: request.expectedSize
          });
        }
        this.flushDownloadProgress();
        out.end();
        await finished(out);
      } catch (e) {
        silenceWriteStreamErrors();
        out.destroy();
        throw e;
      }

      if (request.expectedSize >= 0 && size !== request.expectedSize) {
        throw new LauncherError(ErrorCode.DOWNLOAD_SIZE_MISMATCH, "downloaded size mismatch", {
          id: request.id,
          size,
          expectedSize: request.expectedSize
        });
      }

      const digest = hash.digest("hex");
      if (digest !== integrity.digest) {
        throw new LauncherError(ErrorCode.DOWNLOAD_HASH_MISMATCH, `downloaded ${integrity.algorithm} mismatch`, {
          id: request.id,
          algorithm: integrity.algorithm,
          expected: integrity.digest,
          actual: digest
        });
      }

      this.emitter?.emit("DOWNLOAD_VERIFIED", {
        id: request.id,
        digest,
        algorithm: integrity.algorithm,
        size,
        tempPath
      });

      return {
        request,
        tempPath,
        digest,
        algorithm: integrity.algorithm,
        sha256: integrity.algorithm === "sha256" ? digest : "",
        size
      };
    } catch (e) {
      await cleanupTemp(tempPath);
      if (LauncherError.isLauncherError(e)) throw e;
      if (signal?.aborted) {
        throw new LauncherError(ErrorCode.DOWNLOAD_ABORTED, "download aborted", { id: request.id });
      }
      throw new LauncherError(ErrorCode.DOWNLOAD_FAILED, e instanceof Error ? e.message : String(e), {
        id: request.id
      });
    }
  }
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
}

export { isRetryableDownloadError } from "./retry.js";
export { parseContentLengthHeader } from "./contentLength.js";
export { MAX_DOWNLOAD_REDIRECTS } from "./types.js";
