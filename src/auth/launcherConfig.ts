import { ErrorCode, LauncherError } from "../core/errors/index.js";
import {
  assertMicrosoftClientIdUuid,
  createMicrosoftOAuthConfig,
  type MicrosoftOAuthConfig
} from "./config.js";

/**
 * Public launcher auth configuration (no secrets).
 * microsoftClientId is a public Application (client) ID — never a client_secret.
 */
export interface LauncherAuthConfig {
  microsoftClientId: string;
  /**
   * `localhost-dynamic` — bind 127.0.0.1 ephemeral port; redirectUri = http://localhost:{port}/
   * Matches Entra native redirect registration `http://localhost` (port confirmed at live test).
   */
  redirectStrategy: "localhost-dynamic";
}

export const ENV_MICROSOFT_CLIENT_ID = "SWEETCRAFT_MICROSOFT_CLIENT_ID";
export const ENV_ALLOW_LIVE_AUTH = "SWEETCRAFT_ALLOW_LIVE_AUTH";

/**
 * Public Microsoft Entra application (client) ID for SweetCraft Launcher (production).
 * This is NOT a secret — it is safe to embed. Never confuse with client_secret.
 */
export const PRODUCT_MICROSOFT_CLIENT_ID = "1cd11e2e-955a-46ba-819c-853a754646a4";

/**
 * Resolve public client id.
 * Precedence: explicit CLI/opt override → env override → embedded product default.
 * Never invent a clientId. Never read secrets from this env var.
 */
export function resolveLauncherAuthConfig(opts?: {
  clientId?: string;
  env?: NodeJS.ProcessEnv;
}): LauncherAuthConfig {
  const env = opts?.env ?? process.env;
  const fromOpt = opts?.clientId?.trim();
  const fromEnv = env[ENV_MICROSOFT_CLIENT_ID]?.trim();
  const raw = fromOpt || fromEnv || PRODUCT_MICROSOFT_CLIENT_ID;
  if (!raw) {
    throw new LauncherError(
      ErrorCode.MICROSOFT_CLIENT_ID_MISSING,
      "Microsoft public client id missing",
      {}
    );
  }
  // Reject values that look like secrets (heuristic fail-closed for accidental misuse)
  if (/secret|password|token|bearer/i.test(raw) || raw.length > 64) {
    throw new LauncherError(ErrorCode.INVALID_OAUTH_CONFIG, "clientId value rejected", {});
  }
  const microsoftClientId = assertMicrosoftClientIdUuid(raw);
  return Object.freeze({
    microsoftClientId,
    redirectStrategy: "localhost-dynamic" as const
  });
}

export function createOAuthConfigFromLauncherAuth(
  launcher: LauncherAuthConfig,
  redirectUri: string
): MicrosoftOAuthConfig {
  return createMicrosoftOAuthConfig({
    clientId: launcher.microsoftClientId,
    redirectUri
  });
}

/** Live network gate — unit tests must never set this.
 * Packaged Electron production (`packagedProduction: true`) allows LIVE auth
 * without SWEETCRAFT_ALLOW_LIVE_AUTH — product intent for shipped builds.
 * Unpackaged / CLI / tests keep the explicit env or --live flag gate.
 */
export function assertLiveAuthEnabled(opts?: {
  liveFlag?: boolean;
  env?: NodeJS.ProcessEnv;
  /** When true, product packaged runtime may use LIVE Microsoft auth without env gate. */
  packagedProduction?: boolean;
}): void {
  if (opts?.packagedProduction === true) {
    return;
  }
  const env = opts?.env ?? process.env;
  const envOk = env[ENV_ALLOW_LIVE_AUTH] === "1";
  const flagOk = opts?.liveFlag === true;
  if (!envOk && !flagOk) {
    throw new LauncherError(
      ErrorCode.LIVE_AUTH_NOT_ENABLED,
      "live auth disabled (pass --live and/or SWEETCRAFT_ALLOW_LIVE_AUTH=1)",
      {}
    );
  }
}

/** Whether LIVE interactive auth is allowed for the given context (no throw). */
export function isLiveAuthAllowed(opts?: {
  liveFlag?: boolean;
  env?: NodeJS.ProcessEnv;
  packagedProduction?: boolean;
}): boolean {
  try {
    assertLiveAuthEnabled(opts);
    return true;
  } catch {
    return false;
  }
}
