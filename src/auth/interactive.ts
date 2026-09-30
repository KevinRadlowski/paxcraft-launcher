import type { SystemBrowser } from "./browser.js";
import type { Clock } from "./clock.js";
import type { AuthHttpTransport } from "./http/transport.js";
import { FetchAuthHttpTransport } from "./http/transport.js";
import {
  createOAuthConfigFromLauncherAuth,
  type LauncherAuthConfig
} from "./launcherConfig.js";
import { createMicrosoftAuthorizationFlow } from "./oauth/flow.js";
import { startLoopbackOAuthCallbackServer } from "./oauth/callback.js";
import {
  completeAuthFromCallbackResult,
  type AuthPipelineDeps
} from "./pipeline.js";
import type { AuthTokenStore } from "./store.js";
import type { AccountRegistry } from "./accountsFile.js";
import { InMemoryAccountRegistry } from "./account.js";
import type { MinecraftAuthSession } from "./session.js";
import type { ProgressEmitter } from "../instance/events/index.js";
import type { SecureRefreshTokenStore } from "./secureStore/types.js";
import { ErrorCode, LauncherError } from "../core/errors/index.js";

export interface SignInInteractivelyDeps {
  launcherAuth: LauncherAuthConfig;
  browser: SystemBrowser;
  clock: Clock;
  store: AuthTokenStore;
  accounts?: AccountRegistry | InMemoryAccountRegistry;
  transport?: AuthHttpTransport;
  emitter?: ProgressEmitter;
  secureStore?: SecureRefreshTokenStore;
  /** Prefer persist refresh when secure store available. */
  persistRefresh?: boolean;
  callbackTimeoutMs?: number;
  signal?: AbortSignal;
  /** Override path; default "/" for http://localhost:{port}/ */
  callbackPath?: string;
}

export interface SignInInteractivelyResult {
  session: MinecraftAuthSession;
  securePersistence: boolean;
}

/**
 * Full interactive Microsoft login:
 * loopback → browser → callback → PKCE exchange → Xbox → XSTS → MC → entitlements → profile.
 */
export async function signInInteractively(
  deps: SignInInteractivelyDeps
): Promise<SignInInteractivelyResult> {
  if (deps.signal?.aborted) {
    throw new LauncherError(ErrorCode.AUTH_REQUEST_ABORTED, "sign-in aborted", {});
  }

  const loopback = await startLoopbackOAuthCallbackServer({
    clock: deps.clock,
    ...(deps.emitter ? { emitter: deps.emitter } : {}),
    path: deps.callbackPath ?? "/"
  });

  const securePersistence = !!(
    deps.persistRefresh !== false &&
    deps.secureStore?.available
  );

  try {
    const config = createOAuthConfigFromLauncherAuth(deps.launcherAuth, loopback.redirectUri);
    const { flow, authorizationUrl } = createMicrosoftAuthorizationFlow({
      config,
      clock: deps.clock,
      ...(deps.emitter ? { emitter: deps.emitter } : {})
    });

    await deps.browser.open(authorizationUrl);

    const cb = await loopback.waitForCallback(flow, {
      timeoutMs: deps.callbackTimeoutMs ?? 5 * 60 * 1000,
      ...(deps.signal ? { signal: deps.signal } : {})
    });

    const transport = deps.transport ?? new FetchAuthHttpTransport();
    const pipelineDeps: AuthPipelineDeps = {
      config,
      transport,
      clock: deps.clock,
      store: deps.store,
      ...(deps.accounts ? { accounts: deps.accounts as InMemoryAccountRegistry } : {}),
      ...(deps.emitter ? { emitter: deps.emitter } : {})
    };

    const session = await completeAuthFromCallbackResult(pipelineDeps, flow, cb);

    // Persist refresh via store.save (SecureBackedAuthTokenStore) — already done in pipeline.
    // If persistence required but unavailable, surface clearly without plaintext write.
    if (deps.persistRefresh !== false && deps.secureStore && !deps.secureStore.available) {
      // Session remains valid in-memory; caller sees securePersistence=false
    }

    return { session, securePersistence };
  } finally {
    await loopback.close();
  }
}
