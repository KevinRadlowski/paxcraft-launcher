import type { MicrosoftOAuthConfig } from "./config.js";
import type { Clock } from "./clock.js";
import { isExpired } from "./clock.js";
import type { AuthHttpTransport } from "./http/transport.js";
import { createMicrosoftAuthorizationFlow } from "./oauth/flow.js";
import { exchangeAuthorizationCode, refreshMicrosoftToken } from "./oauth/exchange.js";
import { parseOAuthCallbackUrl, type OAuthCallbackResult } from "./oauth/callback.js";
import type { OAuthFlowState } from "./pkce.js";
import { authenticateXboxLive, authorizeXsts } from "./xbox/index.js";
import {
  assertOwnsMinecraftJava,
  fetchMinecraftEntitlements,
  fetchMinecraftProfile,
  loginWithXbox
} from "./minecraft/services.js";
import { normalizeMinecraftUuid } from "./minecraft/uuid.js";
import { accountIdFromMinecraftUuid, type InMemoryAccountRegistry } from "./account.js";
import type { AccountRegistry } from "./accountsFile.js";
import { buildSession, type MinecraftAuthSession } from "./session.js";
import type { AuthTokenStore, PersistedAuthCredentials } from "./store.js";
import { AuthStateMachine } from "./state.js";
import type { ProgressEmitter } from "../instance/events/index.js";
import { ErrorCode, LauncherError } from "../core/errors/index.js";

export interface AuthPipelineDeps {
  config: MicrosoftOAuthConfig;
  transport: AuthHttpTransport;
  clock: Clock;
  store: AuthTokenStore;
  accounts?: AccountRegistry | InMemoryAccountRegistry;
  emitter?: ProgressEmitter;
}

/**
 * Complete Microsoft → Xbox → XSTS → Minecraft → entitlements → profile pipeline
 * starting from an authorization code callback URL (tests / injected redirect).
 */
export async function completeAuthFromCallbackUrl(
  deps: AuthPipelineDeps,
  flow: OAuthFlowState,
  callbackUrl: string
): Promise<MinecraftAuthSession> {
  const cb = parseOAuthCallbackUrl(callbackUrl, flow, deps.clock);
  return completeAuthFromCallbackResult(deps, flow, cb);
}

/** Continue auth after loopback already returned { code, state }. */
export async function completeAuthFromCallbackResult(
  deps: AuthPipelineDeps,
  flow: OAuthFlowState,
  cb: OAuthCallbackResult
): Promise<MinecraftAuthSession> {
  const sm = new AuthStateMachine();
  try {
    sm.transition("AUTHORIZING_MICROSOFT");
    deps.emitter?.emit("AUTH_CALLBACK_RECEIVED", { ok: true });

    const microsoft = await exchangeAuthorizationCode({
      config: deps.config,
      flow,
      code: cb.code,
      state: cb.state,
      transport: deps.transport,
      clock: deps.clock,
      ...(deps.emitter ? { emitter: deps.emitter } : {})
    });
    sm.transition("MICROSOFT_AUTHENTICATED");

    sm.transition("AUTHENTICATING_XBOX");
    const xbox = await authenticateXboxLive({
      microsoftAccessToken: microsoft.accessToken,
      transport: deps.transport,
      clock: deps.clock,
      ...(deps.emitter ? { emitter: deps.emitter } : {})
    });

    sm.transition("AUTHORIZING_XSTS");
    const xsts = await authorizeXsts({
      xbox,
      transport: deps.transport,
      clock: deps.clock,
      ...(deps.emitter ? { emitter: deps.emitter } : {})
    });

    sm.transition("AUTHENTICATING_MINECRAFT");
    const minecraft = await loginWithXbox({
      xsts,
      transport: deps.transport,
      clock: deps.clock,
      ...(deps.emitter ? { emitter: deps.emitter } : {})
    });

    sm.transition("CHECKING_ENTITLEMENTS");
    const entitlements = await fetchMinecraftEntitlements({
      minecraftAccessToken: minecraft.accessToken,
      transport: deps.transport,
      ...(deps.emitter ? { emitter: deps.emitter } : {})
    });
    assertOwnsMinecraftJava(entitlements);

    sm.transition("FETCHING_PROFILE");
    const profile = await fetchMinecraftProfile({
      minecraftAccessToken: minecraft.accessToken,
      transport: deps.transport,
      ...(deps.emitter ? { emitter: deps.emitter } : {})
    });

    const uuid = normalizeMinecraftUuid(profile.id);
    const accountId = accountIdFromMinecraftUuid(uuid);
    const session = buildSession({
      accountId,
      microsoft,
      minecraft,
      profile,
      entitlements,
      createdAtMs: deps.clock.nowMs(),
      clientId: deps.config.clientId
    });

    if (session.launchIdentity.accessToken === microsoft.accessToken) {
      throw new LauncherError(ErrorCode.AUTH_SESSION_ERROR, "launch token must be Minecraft access token");
    }

    const persisted: PersistedAuthCredentials = {
      accountId,
      microsoft,
      minecraft,
      profile,
      entitlements,
      updatedAtMs: deps.clock.nowMs()
    };
    try {
      await deps.store.save(accountId, persisted);
    } catch (e) {
      if (
        LauncherError.isLauncherError(e) &&
        e.code === ErrorCode.AUTH_SECURE_STORAGE_UNAVAILABLE
      ) {
        // Fail-closed disk: keep session in volatile path only when store allows;
        // SecureBackedAuthTokenStore with persistRefresh=false avoids this.
        // If thrown, rethrow — caller must not write plaintext.
        throw e;
      }
      throw e;
    }
    await Promise.resolve(
      deps.accounts?.upsert({
        accountId,
        minecraftUuid: uuid,
        minecraftUsername: profile.name,
        lastUsedAtMs: deps.clock.nowMs()
      })
    );

    sm.transition("SIGNED_IN");
    deps.emitter?.emit("AUTH_SESSION_READY", {
      accountId,
      minecraftUsername: profile.name
    });
    return session;
  } catch (e) {
    const stage = sm.current;
    sm.transition("ERROR");
    const errorCode = LauncherError.isLauncherError(e) ? e.code : ErrorCode.AUTH_SESSION_ERROR;
    deps.emitter?.emit("AUTH_FAILED", { stage, errorCode });
    if (LauncherError.isLauncherError(e)) throw e;
    throw new LauncherError(ErrorCode.AUTH_SESSION_ERROR, "auth pipeline failed", {
      stage
    });
  }
}

export async function refreshAuthSession(
  deps: AuthPipelineDeps,
  accountId: string,
  opts: { signal?: AbortSignal } = {}
): Promise<MinecraftAuthSession> {
  if (opts.signal?.aborted) {
    throw new LauncherError(ErrorCode.AUTH_REQUEST_ABORTED, "auth request aborted by caller", {});
  }
  const existing = await deps.store.load(accountId);
  if (!existing?.microsoft.refreshToken) {
    throw new LauncherError(ErrorCode.AUTH_REAUTH_REQUIRED, "no refresh token stored", {
      accountId
    });
  }
  const signalOpts = opts.signal ? { signal: opts.signal } : {};
  let microsoft;
  try {
    microsoft = await refreshMicrosoftToken({
      config: deps.config,
      refreshToken: existing.microsoft.refreshToken,
      transport: deps.transport,
      clock: deps.clock,
      ...(deps.emitter ? { emitter: deps.emitter } : {}),
      ...signalOpts
    });
  } catch (e) {
    // Only AUTH_REAUTH_REQUIRED (e.g. invalid_grant) deletes the secure credential.
    // Transient network / 5xx / timeout / abort / INVALID_TOKEN_RESPONSE keep it.
    if (LauncherError.isLauncherError(e) && e.code === ErrorCode.AUTH_REAUTH_REQUIRED) {
      await deps.store.delete(accountId).catch(() => undefined);
      throw e;
    }
    throw e;
  }

  const xbox = await authenticateXboxLive({
    microsoftAccessToken: microsoft.accessToken,
    transport: deps.transport,
    clock: deps.clock,
    ...(deps.emitter ? { emitter: deps.emitter } : {}),
    ...signalOpts
  });
  const xsts = await authorizeXsts({
    xbox,
    transport: deps.transport,
    clock: deps.clock,
    ...(deps.emitter ? { emitter: deps.emitter } : {}),
    ...signalOpts
  });
  const minecraft = await loginWithXbox({
    xsts,
    transport: deps.transport,
    clock: deps.clock,
    ...(deps.emitter ? { emitter: deps.emitter } : {}),
    ...signalOpts
  });
  const entitlements = await fetchMinecraftEntitlements({
    minecraftAccessToken: minecraft.accessToken,
    transport: deps.transport,
    ...(deps.emitter ? { emitter: deps.emitter } : {}),
    ...signalOpts
  });
  assertOwnsMinecraftJava(entitlements);
  const profile = await fetchMinecraftProfile({
    minecraftAccessToken: minecraft.accessToken,
    transport: deps.transport,
    ...(deps.emitter ? { emitter: deps.emitter } : {}),
    ...signalOpts
  });

  // Account binding: restored profile must match requested accountId.
  // Fail closed BEFORE persist — do not overwrite metadata X with profile Y,
  // do not save credential under wrong binding, do not bump lastUsed.
  // Credential under X is left in place for explicit re-auth (not auto-deleted).
  const uuid = normalizeMinecraftUuid(profile.id);
  const derivedAccountId = accountIdFromMinecraftUuid(uuid);
  if (derivedAccountId !== accountId) {
    throw new LauncherError(
      ErrorCode.AUTH_ACCOUNT_MISMATCH,
      "restored Minecraft identity does not match requested account",
      {
        expectedAccountId: accountId,
        // Safe ids only — never tokens
        derivedAccountId
      }
    );
  }

  const session = buildSession({
    accountId,
    microsoft,
    minecraft,
    profile,
    entitlements,
    createdAtMs: deps.clock.nowMs(),
    clientId: deps.config.clientId
  });
  // Rotation: store.save writes new refresh to secure store before returning
  await deps.store.save(accountId, {
    accountId,
    microsoft,
    minecraft,
    profile,
    entitlements,
    updatedAtMs: deps.clock.nowMs()
  });
  const prior = deps.accounts ? await Promise.resolve(deps.accounts.get(accountId)) : undefined;
  await Promise.resolve(
    deps.accounts?.upsert({
      accountId,
      minecraftUuid: uuid,
      minecraftUsername: profile.name,
      // Refresh must not mark lastUsed — PLAY marks after verified launch start.
      lastUsedAtMs: prior?.lastUsedAtMs ?? 0
    })
  );
  return session;
}

/** Restore a persisted account via secure refresh token → full pipeline. */
export async function restoreAuthSession(
  deps: AuthPipelineDeps,
  accountId: string,
  opts: { signal?: AbortSignal } = {}
): Promise<MinecraftAuthSession> {
  return refreshAuthSession(deps, accountId, opts);
}

export function sessionNeedsRefresh(session: MinecraftAuthSession, clock: Clock): boolean {
  return (
    isExpired(session.minecraft.expiresAtMs, clock) || isExpired(session.microsoft.expiresAtMs, clock)
  );
}

export interface LogoutOptions {
  deleteAccountMetadata?: boolean;
}

/**
 * Local logout only — does not claim remote Microsoft token revocation.
 * Deletes secure refresh credential + volatile session + optional metadata.
 */
export async function logoutAccount(
  deps: AuthPipelineDeps,
  accountId: string,
  opts: LogoutOptions = {}
): Promise<void> {
  await deps.store.delete(accountId);
  if (opts.deleteAccountMetadata !== false) {
    await Promise.resolve(deps.accounts?.delete(accountId));
  }
  deps.emitter?.emit("AUTH_LOGGED_OUT", { accountId });
}

export { createMicrosoftAuthorizationFlow };
