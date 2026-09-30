import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import type { ReleaseChannelName } from "../../core/channel/index.js";

/**
 * Anti-rollback contract (explicit):
 *
 * - Each channel maintains an independent highestAcceptedReleaseSequence.
 * - Incoming releaseSequence < highest → ROLLBACK_DETECTED (refuse).
 * - Incoming releaseSequence > highest → accept (caller persists after full resolve success).
 * - Incoming releaseSequence === highest → accept ONLY if identity matches the last accepted
 *   release for that channel: same packVersion, releasePath, and releaseSha256.
 *   Otherwise refuse (same sequence pointing at a different artefact is treated as rollback/tamper).
 *
 * Persistence is atomic: write temp file then rename into place.
 */

export interface AcceptedChannelRelease {
  highestAcceptedReleaseSequence: number;
  acceptedPackVersion: string;
  acceptedReleasePath: string;
  acceptedReleaseSha256: string;
  acceptedAt: string;
}

export interface AntiRollbackState {
  schemaVersion: 1;
  channels: Partial<Record<ReleaseChannelName, AcceptedChannelRelease>>;
}

export interface CandidateReleaseIdentity {
  channel: ReleaseChannelName;
  releaseSequence: number;
  packVersion: string;
  releasePath: string;
  releaseSha256: string;
}

const EMPTY_STATE: AntiRollbackState = { schemaVersion: 1, channels: {} };

export function createEmptyAntiRollbackState(): AntiRollbackState {
  return { schemaVersion: 1, channels: {} };
}

export function checkAntiRollback(state: AntiRollbackState, candidate: CandidateReleaseIdentity): void {
  const prev = state.channels[candidate.channel];
  if (!prev) {
    return;
  }
  if (candidate.releaseSequence < prev.highestAcceptedReleaseSequence) {
    throw new LauncherError(ErrorCode.ROLLBACK_DETECTED, "releaseSequence behind highest accepted", {
      channel: candidate.channel,
      candidate: candidate.releaseSequence,
      highestAccepted: prev.highestAcceptedReleaseSequence
    });
  }
  if (candidate.releaseSequence === prev.highestAcceptedReleaseSequence) {
    const sameIdentity =
      candidate.packVersion === prev.acceptedPackVersion &&
      candidate.releasePath === prev.acceptedReleasePath &&
      candidate.releaseSha256.toLowerCase() === prev.acceptedReleaseSha256.toLowerCase();
    if (!sameIdentity) {
      throw new LauncherError(
        ErrorCode.ROLLBACK_DETECTED,
        "equal releaseSequence but different release identity refused",
        {
          channel: candidate.channel,
          candidate,
          accepted: prev
        }
      );
    }
  }
}

export function withAcceptedRelease(state: AntiRollbackState, candidate: CandidateReleaseIdentity): AntiRollbackState {
  checkAntiRollback(state, candidate);
  return {
    schemaVersion: 1,
    channels: {
      ...state.channels,
      [candidate.channel]: {
        highestAcceptedReleaseSequence: candidate.releaseSequence,
        acceptedPackVersion: candidate.packVersion,
        acceptedReleasePath: candidate.releasePath,
        acceptedReleaseSha256: candidate.releaseSha256.toLowerCase(),
        acceptedAt: new Date().toISOString()
      }
    }
  };
}

export class FileAntiRollbackStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<AntiRollbackState> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as AntiRollbackState;
      if (parsed.schemaVersion !== 1 || typeof parsed.channels !== "object" || parsed.channels === null) {
        throw new LauncherError(ErrorCode.STATE_ERROR, "invalid anti-rollback state schema");
      }
      return parsed;
    } catch (e) {
      if (LauncherError.isLauncherError(e)) throw e;
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return createEmptyAntiRollbackState();
      }
      throw new LauncherError(ErrorCode.STATE_ERROR, "failed to load anti-rollback state", {
        cause: e instanceof Error ? e.message : String(e)
      });
    }
  }

  async saveAtomic(state: AntiRollbackState): Promise<void> {
    const dir = path.dirname(this.filePath);
    await mkdir(dir, { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const payload = JSON.stringify(state, null, 2) + "\n";
    await writeFile(tmp, payload, "utf8");
    await rename(tmp, this.filePath);
  }
}
