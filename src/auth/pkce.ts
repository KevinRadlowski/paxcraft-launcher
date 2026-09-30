import { createHash, randomBytes } from "node:crypto";
import { ErrorCode, LauncherError } from "../core/errors/index.js";
import type { Clock } from "./clock.js";

const VERIFIER_MIN = 43;
const VERIFIER_MAX = 128;

/** RFC 7636 unreserved charset for code_verifier. */
const VERIFIER_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

export function generateCodeVerifier(byteLength: number = 32): string {
  // Produce 43–128 chars from unreserved set
  const bytes = randomBytes(Math.max(32, byteLength));
  let out = "";
  for (let i = 0; i < bytes.length && out.length < VERIFIER_MAX; i++) {
    out += VERIFIER_ALPHABET[bytes[i]! % VERIFIER_ALPHABET.length]!;
  }
  while (out.length < VERIFIER_MIN) {
    out += VERIFIER_ALPHABET[randomBytes(1)[0]! % VERIFIER_ALPHABET.length]!;
  }
  return out.slice(0, VERIFIER_MAX);
}

export function generateOAuthState(byteLength: number = 32): string {
  return base64Url(randomBytes(byteLength));
}

/** S256: BASE64URL(SHA256(ascii(codeVerifier))) */
export function computeCodeChallengeS256(codeVerifier: string): string {
  if (codeVerifier.length < VERIFIER_MIN || codeVerifier.length > VERIFIER_MAX) {
    throw new LauncherError(ErrorCode.INVALID_OAUTH_CONFIG, "invalid code_verifier length");
  }
  return base64Url(createHash("sha256").update(codeVerifier, "ascii").digest());
}

export function base64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export interface OAuthFlowState {
  readonly flowId: string;
  readonly state: string;
  readonly codeVerifier: string;
  readonly createdAtMs: number;
  readonly redirectUri: string;
  readonly expiresAtMs: number;
  consumed: boolean;
}

export const DEFAULT_OAUTH_FLOW_TTL_MS = 10 * 60 * 1000;

export function createOAuthFlowState(opts: {
  redirectUri: string;
  clock: Clock;
  ttlMs?: number;
}): OAuthFlowState {
  const createdAtMs = opts.clock.nowMs();
  const ttl = opts.ttlMs ?? DEFAULT_OAUTH_FLOW_TTL_MS;
  return {
    flowId: generateOAuthState(16),
    state: generateOAuthState(32),
    codeVerifier: generateCodeVerifier(64),
    createdAtMs,
    redirectUri: opts.redirectUri,
    expiresAtMs: createdAtMs + ttl,
    consumed: false
  };
}

export function assertFlowUsable(flow: OAuthFlowState, clock: Clock, expectedState?: string): void {
  if (flow.consumed) {
    throw new LauncherError(ErrorCode.OAUTH_FLOW_ALREADY_CONSUMED, "OAuth flow already consumed");
  }
  if (clock.nowMs() > flow.expiresAtMs) {
    throw new LauncherError(ErrorCode.OAUTH_FLOW_EXPIRED, "OAuth flow expired");
  }
  if (expectedState !== undefined && expectedState !== flow.state) {
    throw new LauncherError(ErrorCode.OAUTH_STATE_MISMATCH, "OAuth state mismatch");
  }
}

export function consumeFlow(flow: OAuthFlowState): void {
  flow.consumed = true;
}
