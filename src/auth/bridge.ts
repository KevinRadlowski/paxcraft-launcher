import { validateLaunchIdentity, type LaunchIdentity } from "../launch/identity.js";
import type { MinecraftAccessToken, MinecraftProfile } from "./minecraft/services.js";
import { normalizeMinecraftUuid } from "./minecraft/uuid.js";

/**
 * Bridge Minecraft session → LaunchIdentity for Launch Engine 0.3B.
 * Uses Minecraft access token (NOT Microsoft access token) as auth_access_token.
 */
export function createLaunchIdentityFromMinecraftSession(opts: {
  minecraftAccessToken: MinecraftAccessToken;
  profile: MinecraftProfile;
  xuid?: string;
  clientId?: string;
}): LaunchIdentity {
  const uuid = normalizeMinecraftUuid(opts.profile.id);
  const identity: LaunchIdentity = {
    username: opts.profile.name,
    uuid,
    accessToken: opts.minecraftAccessToken.accessToken,
    userType: "msa",
    userProperties: {},
    profileProperties: {}
  };
  if (opts.xuid) identity.xuid = opts.xuid;
  if (opts.clientId) identity.clientId = opts.clientId;
  return validateLaunchIdentity(identity);
}
