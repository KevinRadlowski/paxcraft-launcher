import { ErrorCode, LauncherError } from "../../core/errors/index.js";

/** Supported download integrity algorithms. SweetCraft artefacts remain SHA-256. */
export type HashAlgorithm = "sha256" | "sha1";

export interface IntegrityExpectation {
  algorithm: HashAlgorithm;
  /** Hex digest (lowercase preferred). */
  digest: string;
}

const DIGEST_RE: Record<HashAlgorithm, RegExp> = {
  sha256: /^[a-fA-F0-9]{64}$/,
  sha1: /^[a-fA-F0-9]{40}$/
};

export function assertIntegrityExpectation(integrity: IntegrityExpectation): IntegrityExpectation {
  if (integrity.algorithm !== "sha256" && integrity.algorithm !== "sha1") {
    throw new LauncherError(ErrorCode.UNSUPPORTED_INTEGRITY_ALGORITHM, "unsupported integrity algorithm", {
      algorithm: (integrity as IntegrityExpectation).algorithm
    });
  }
  if (!DIGEST_RE[integrity.algorithm].test(integrity.digest)) {
    throw new LauncherError(ErrorCode.DOWNLOAD_HASH_MISMATCH, "invalid integrity digest format", {
      algorithm: integrity.algorithm,
      digest: integrity.digest
    });
  }
  return {
    algorithm: integrity.algorithm,
    digest: integrity.digest.toLowerCase()
  };
}

export function sha256Integrity(digest: string): IntegrityExpectation {
  return assertIntegrityExpectation({ algorithm: "sha256", digest });
}

export function sha1Integrity(digest: string): IntegrityExpectation {
  return assertIntegrityExpectation({ algorithm: "sha1", digest });
}
