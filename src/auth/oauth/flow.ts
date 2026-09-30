import type { MicrosoftOAuthConfig } from "../config.js";
import type { Clock } from "../clock.js";
import {
  computeCodeChallengeS256,
  createOAuthFlowState,
  type OAuthFlowState
} from "../pkce.js";
import type { ProgressEmitter } from "../../instance/events/index.js";

export interface CreatedAuthorizationFlow {
  /** Opaque handle — never log codeVerifier. */
  flow: OAuthFlowState;
  authorizationUrl: string;
}

/**
 * Build Microsoft authorization URL for public client + PKCE S256.
 * code_verifier is NEVER placed in the URL.
 */
export function createMicrosoftAuthorizationFlow(opts: {
  config: MicrosoftOAuthConfig;
  clock: Clock;
  emitter?: ProgressEmitter;
  ttlMs?: number;
}): CreatedAuthorizationFlow {
  const flow = createOAuthFlowState({
    redirectUri: opts.config.redirectUri,
    clock: opts.clock,
    ...(opts.ttlMs !== undefined ? { ttlMs: opts.ttlMs } : {})
  });
  const challenge = computeCodeChallengeS256(flow.codeVerifier);
  const url = new URL(opts.config.authorizationEndpoint);
  url.searchParams.set("client_id", opts.config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", opts.config.redirectUri);
  url.searchParams.set("scope", opts.config.scopes.join(" "));
  url.searchParams.set("state", flow.state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  // Prefer account picker
  url.searchParams.set("prompt", "select_account");

  opts.emitter?.emit("AUTH_FLOW_STARTED", {
    flowId: flow.flowId,
    redirectUri: opts.config.redirectUri
  });

  return { flow, authorizationUrl: url.toString() };
}

export function authorizationUrlContainsCodeVerifier(url: string, codeVerifier: string): boolean {
  return url.includes(codeVerifier);
}
