import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import {
  refreshAuthSession,
  restoreAuthSession,
  sessionNeedsRefresh,
  type AuthPipelineDeps
} from "../../auth/pipeline.js";
import type { MinecraftAuthSession } from "../../auth/session.js";
import type { PlaySessionCache } from "./types.js";

export type SessionRestorePhase = "MEMORY" | "REFRESH" | "RESTORE";

/**
 * Resolve a valid MinecraftAuthSession for PLAY.
 * Memory session reused when Minecraft+Microsoft tokens not expired.
 * Otherwise cold restore / refresh via secure store.
 * Never opens interactive browser.
 */
export async function resolvePlaySession(opts: {
  accountId: string;
  auth: AuthPipelineDeps;
  cache?: PlaySessionCache;
  signal?: AbortSignal;
  onPhase?: (phase: SessionRestorePhase) => void;
}): Promise<MinecraftAuthSession> {
  if (opts.signal?.aborted) {
    throw new LauncherError(ErrorCode.AUTH_REQUEST_ABORTED, "session restore aborted", {});
  }

  const cached = opts.cache?.get(opts.accountId);
  if (cached && !sessionNeedsRefresh(cached, opts.auth.clock)) {
    // Logout deletes secure credential — do not launch on memory-only after logout.
    const existing = await opts.auth.store.load(opts.accountId);
    if (!existing?.microsoft.refreshToken) {
      opts.cache?.delete(opts.accountId);
      throw new LauncherError(ErrorCode.AUTH_LOGIN_REQUIRED, "no secure refresh credential", {
        accountId: opts.accountId
      });
    }
    opts.onPhase?.("MEMORY");
    return cached;
  }

  const existing = await opts.auth.store.load(opts.accountId);
  if (!existing?.microsoft.refreshToken) {
    throw new LauncherError(ErrorCode.AUTH_LOGIN_REQUIRED, "no secure refresh credential", {
      accountId: opts.accountId
    });
  }

  opts.onPhase?.(cached ? "REFRESH" : "RESTORE");

  const signalOpts = opts.signal ? { signal: opts.signal } : {};
  try {
    const session = cached
      ? await refreshAuthSession(opts.auth, opts.accountId, signalOpts)
      : await restoreAuthSession(opts.auth, opts.accountId, signalOpts);
    opts.cache?.set(session);
    return session;
  } catch (e) {
    if (LauncherError.isLauncherError(e)) {
      if (e.code === ErrorCode.AUTH_REAUTH_REQUIRED) {
        opts.cache?.delete(opts.accountId);
        throw e;
      }
      if (e.code === ErrorCode.AUTH_ACCOUNT_MISMATCH) {
        // Keep credential; drop tainted memory session if any
        opts.cache?.delete(opts.accountId);
        throw e;
      }
    }
    throw e;
  }
}

/** Explicit cold-start API for process-B restore without memory tokens. */
export async function coldRestorePlaySession(
  auth: AuthPipelineDeps,
  accountId: string,
  cache?: PlaySessionCache,
  opts: { signal?: AbortSignal } = {}
): Promise<MinecraftAuthSession> {
  cache?.delete(accountId);
  const session = await restoreAuthSession(auth, accountId, opts);
  cache?.set(session);
  return session;
}
