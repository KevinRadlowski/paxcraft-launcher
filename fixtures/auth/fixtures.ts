import { createHash } from "node:crypto";
import {
  XBOX_USER_AUTH_URL,
  XSTS_AUTH_URL
} from "../../src/auth/xbox/index.js";
import {
  MC_LOGIN_WITH_XBOX_URL,
  MC_ENTITLEMENTS_URL,
  MC_PROFILE_URL
} from "../../src/auth/minecraft/services.js";
import type { MockAuthHttpTransport } from "../../src/auth/http/transport.js";
import {
  DEFAULT_MS_TOKEN_ENDPOINT
} from "../../src/auth/config.js";

export const FAKE_MS_ACCESS = "ms.access." + "A".repeat(40);
export const FAKE_MS_REFRESH = "ms.refresh." + "B".repeat(40);
export const FAKE_MS_REFRESH_ROTATED = "ms.refresh." + "C".repeat(40);
export const FAKE_XBOX_TOKEN = "xbox." + "D".repeat(40);
export const FAKE_XSTS_TOKEN = "xsts." + "E".repeat(40);
export const FAKE_MC_ACCESS = "mc.access." + "F".repeat(40);
export const FAKE_UHS = "1234567890abcdef";
export const FAKE_PROFILE_ID_RAW = "00112233445566778899aabbccddeeff";
export const FAKE_PROFILE_ID_HYPHEN = "00112233-4455-6677-8899-aabbccddeeff";
export const FAKE_USERNAME = "SweetCraftPlayer";

export function xboxBody(uhs = FAKE_UHS, token = FAKE_XBOX_TOKEN): string {
  return JSON.stringify({
    IssueInstant: "2026-01-01T00:00:00.0000000Z",
    NotAfter: "2026-01-02T00:00:00.0000000Z",
    Token: token,
    DisplayClaims: { xui: [{ uhs }] }
  });
}

export function xstsBody(uhs = FAKE_UHS, token = FAKE_XSTS_TOKEN): string {
  return xboxBody(uhs, token);
}

export function msTokenBody(opts?: { refresh?: string; expires_in?: number }): string {
  return JSON.stringify({
    token_type: "Bearer",
    scope: "XboxLive.signin offline_access",
    expires_in: opts?.expires_in ?? 3600,
    access_token: FAKE_MS_ACCESS,
    refresh_token: opts?.refresh ?? FAKE_MS_REFRESH
  });
}

export function mcLoginBody(): string {
  return JSON.stringify({
    username: "ignored",
    roles: [],
    access_token: FAKE_MC_ACCESS,
    token_type: "Bearer",
    expires_in: 86400
  });
}

export function entitlementsOwnedBody(): string {
  return JSON.stringify({
    items: [
      { name: "product_minecraft", source: "PRODUCT" },
      { name: "game_minecraft", source: "PRODUCT" }
    ]
  });
}

export function entitlementsEmptyBody(): string {
  return JSON.stringify({ items: [] });
}

export function profileBody(id: string = FAKE_PROFILE_ID_RAW): string {
  return JSON.stringify({
    id,
    name: FAKE_USERNAME,
    skins: [],
    capes: []
  });
}

/** Wire a full successful auth chain on the mock transport. */
export function installHappyAuthRoutes(transport: MockAuthHttpTransport): void {
  transport.set("POST", DEFAULT_MS_TOKEN_ENDPOINT, msTokenBody());
  transport.set("POST", XBOX_USER_AUTH_URL, xboxBody());
  transport.set("POST", XSTS_AUTH_URL, xstsBody());
  transport.set("POST", MC_LOGIN_WITH_XBOX_URL, mcLoginBody());
  transport.set("GET", MC_ENTITLEMENTS_URL, entitlementsOwnedBody());
  transport.set("GET", MC_PROFILE_URL, profileBody());
}

export function sha256Base64Url(ascii: string): string {
  return createHash("sha256")
    .update(ascii, "ascii")
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
