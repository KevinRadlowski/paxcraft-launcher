import type { IntegrityExpectation } from "../../minecraft/integrity/index.js";

export interface DownloadRequest {
  /** Stable id for progress/events */
  id: string;
  url: string;
  /**
   * Explicit integrity (sha256 or sha1).
   * If omitted, `expectedSha256` is required and used as sha256 (SweetCraft path).
   */
  integrity?: IntegrityExpectation;
  /**
   * SHA-256 hex digest for SweetCraft artefacts.
   * Kept for backward compatibility; ignored when `integrity` is set.
   */
  expectedSha256?: string;
  expectedSize: number;
  maxBytes: number;
  timeoutMs: number;
  targetPath: string;
}

export interface DownloadResult {
  request: DownloadRequest;
  tempPath: string;
  /** Hex digest for the algorithm used during verification. */
  digest: string;
  algorithm: "sha256" | "sha1";
  /** @deprecated alias of digest when algorithm is sha256 — kept for callers */
  sha256: string;
  size: number;
}

export interface ByteSourceOpenOptions {
  signal?: AbortSignal;
  timeoutMs: number;
}

export interface ByteSourceOpenResult {
  stream: AsyncIterable<Buffer>;
  contentLength: number | null;
}

export interface ByteSource {
  open(url: string, opts: ByteSourceOpenOptions): Promise<ByteSourceOpenResult>;
}

export const MAX_DOWNLOAD_REDIRECTS = 5;
