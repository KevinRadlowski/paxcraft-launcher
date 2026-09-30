import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import type { AuthHttpTransport } from "../http/transport.js";
import { parseJsonAuthBody } from "../http/transport.js";
import type { XstsToken } from "../xbox/index.js";
import type { Clock } from "../clock.js";
import { computeExpiresAtMs } from "../expiry.js";
import type { ProgressEmitter } from "../../instance/events/index.js";
import { minecraftLoginHttpError } from "./serviceErrors.js";

export const MC_LOGIN_WITH_XBOX_URL =
  "https://api.minecraftservices.com/authentication/login_with_xbox";
export const MC_ENTITLEMENTS_URL = "https://api.minecraftservices.com/entitlements/mcstore";
export const MC_PROFILE_URL = "https://api.minecraftservices.com/minecraft/profile";

export interface MinecraftAccessToken {
  accessToken: string;
  expiresAtMs: number;
}

export interface MinecraftEntitlements {
  items: Array<{ name: string; source?: string }>;
  ownsMinecraftJava: boolean;
}

export interface MinecraftProfile {
  id: string;
  name: string;
  skins?: unknown[];
  capes?: unknown[];
}

/**
 * XSTS → Minecraft Services access token.
 * Identity token format: XBL3.0 x=<userHash>;<xstsToken>
 *
 * Request body is only `{ identityToken }` — we do NOT send `ensureLegacyEnabled`.
 * That flag does not fix INVALID_APP_REGISTRATION and must not be used as a blind workaround.
 */
export async function loginWithXbox(opts: {
  xsts: XstsToken;
  transport: AuthHttpTransport;
  clock: Clock;
  emitter?: ProgressEmitter;
  signal?: AbortSignal;
}): Promise<MinecraftAccessToken> {
  const identityToken = `XBL3.0 x=${opts.xsts.userHash};${opts.xsts.token}`;
  const res = await opts.transport.request({
    url: MC_LOGIN_WITH_XBOX_URL,
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({ identityToken }),
    idempotent: false,
    ...(opts.signal ? { signal: opts.signal } : {})
  });
  if (res.status < 200 || res.status >= 300) {
    throw minecraftLoginHttpError(res.status, res.body);
  }
  const token = parseMinecraftLoginResponse(res.body, opts.clock);
  opts.emitter?.emit("MINECRAFT_AUTHENTICATED", { expiresAtMs: token.expiresAtMs });
  return token;
}

export function parseMinecraftLoginResponse(body: string, clock: Clock): MinecraftAccessToken {
  const raw = parseJsonAuthBody(body, "minecraft login");
  if (!isObj(raw) || typeof raw.access_token !== "string" || !raw.access_token) {
    throw new LauncherError(ErrorCode.INVALID_MINECRAFT_AUTH, "Minecraft access_token missing");
  }
  const expiresIn = raw.expires_in;
  if (typeof expiresIn !== "number" || !Number.isInteger(expiresIn) || expiresIn <= 0) {
    throw new LauncherError(ErrorCode.INVALID_MINECRAFT_AUTH, "expires_in missing/invalid");
  }
  return { accessToken: raw.access_token, expiresAtMs: computeExpiresAtMs(clock, expiresIn) };
}

export async function fetchMinecraftEntitlements(opts: {
  minecraftAccessToken: string;
  transport: AuthHttpTransport;
  emitter?: ProgressEmitter;
  signal?: AbortSignal;
}): Promise<MinecraftEntitlements> {
  const res = await opts.transport.request({
    url: MC_ENTITLEMENTS_URL,
    method: "GET",
    headers: {
      authorization: `Bearer ${opts.minecraftAccessToken}`,
      accept: "application/json"
    },
    idempotent: true,
    ...(opts.signal ? { signal: opts.signal } : {})
  });
  if (res.status < 200 || res.status >= 300) {
    throw new LauncherError(ErrorCode.AUTH_HTTP_ERROR, `entitlements HTTP ${res.status}`, {
      status: res.status
    });
  }
  const entitlements = parseEntitlements(res.body);
  opts.emitter?.emit("ENTITLEMENTS_VERIFIED", {
    ownsMinecraftJava: entitlements.ownsMinecraftJava,
    itemCount: entitlements.items.length
  });
  return entitlements;
}

export function parseEntitlements(body: string): MinecraftEntitlements {
  const raw = parseJsonAuthBody(body, "entitlements");
  if (!isObj(raw) || !Array.isArray(raw.items)) {
    throw new LauncherError(ErrorCode.INVALID_MINECRAFT_AUTH, "entitlements items missing");
  }
  const items: MinecraftEntitlements["items"] = [];
  for (const it of raw.items) {
    if (!isObj(it) || typeof it.name !== "string") continue;
    const entry: { name: string; source?: string } = { name: it.name };
    if (typeof it.source === "string") entry.source = it.source;
    items.push(entry);
  }
  const owns = ownsMinecraftJava(items);
  return { items, ownsMinecraftJava: owns };
}

/**
 * Ownership check — never bypass.
 * product_minecraft / game_minecraft historically indicate Java ownership on mcstore.
 */
export function ownsMinecraftJava(items: Array<{ name: string }>): boolean {
  const names = new Set(items.map((i) => i.name));
  return (
    names.has("product_minecraft") ||
    names.has("game_minecraft") ||
    names.has("product_minecraft_java")
  );
}

export function assertOwnsMinecraftJava(entitlements: MinecraftEntitlements): void {
  if (!entitlements.ownsMinecraftJava) {
    throw new LauncherError(ErrorCode.MINECRAFT_NOT_OWNED, "Minecraft Java not owned on this account");
  }
}

export async function fetchMinecraftProfile(opts: {
  minecraftAccessToken: string;
  transport: AuthHttpTransport;
  emitter?: ProgressEmitter;
  signal?: AbortSignal;
}): Promise<MinecraftProfile> {
  const res = await opts.transport.request({
    url: MC_PROFILE_URL,
    method: "GET",
    headers: {
      authorization: `Bearer ${opts.minecraftAccessToken}`,
      accept: "application/json"
    },
    idempotent: true,
    ...(opts.signal ? { signal: opts.signal } : {})
  });
  if (res.status < 200 || res.status >= 300) {
    throw new LauncherError(ErrorCode.INVALID_MINECRAFT_PROFILE, `profile HTTP ${res.status}`, {
      status: res.status
    });
  }
  const profile = parseMinecraftProfile(res.body);
  opts.emitter?.emit("PROFILE_LOADED", { name: profile.name });
  return profile;
}

export function parseMinecraftProfile(body: string): MinecraftProfile {
  const raw = parseJsonAuthBody(body, "profile");
  if (!isObj(raw) || typeof raw.id !== "string" || !raw.id || typeof raw.name !== "string" || !raw.name) {
    throw new LauncherError(ErrorCode.INVALID_MINECRAFT_PROFILE, "profile id/name missing");
  }
  const profile: MinecraftProfile = { id: raw.id, name: raw.name };
  if (Array.isArray(raw.skins)) profile.skins = raw.skins;
  if (Array.isArray(raw.capes)) profile.capes = raw.capes;
  return profile;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
