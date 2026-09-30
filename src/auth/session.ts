import type { MicrosoftTokenSet } from "./oauth/exchange.js";
import type { MinecraftAccessToken, MinecraftEntitlements, MinecraftProfile } from "./minecraft/services.js";
import type { LaunchIdentity } from "../launch/identity.js";
import { createLaunchIdentityFromMinecraftSession } from "./bridge.js";
import type { AuthState } from "./state.js";

/**
 * Volatile + logical session after a successful auth pipeline.
 * Xbox/XSTS not retained long-term.
 */
export interface MinecraftAuthSession {
  accountId: string;
  state: AuthState;
  microsoft: MicrosoftTokenSet;
  minecraft: MinecraftAccessToken;
  profile: MinecraftProfile;
  entitlements: MinecraftEntitlements;
  launchIdentity: LaunchIdentity;
  createdAtMs: number;
}

export function buildSession(opts: {
  accountId: string;
  microsoft: MicrosoftTokenSet;
  minecraft: MinecraftAccessToken;
  profile: MinecraftProfile;
  entitlements: MinecraftEntitlements;
  createdAtMs: number;
  xuid?: string;
  clientId?: string;
}): MinecraftAuthSession {
  const launchIdentity = createLaunchIdentityFromMinecraftSession({
    minecraftAccessToken: opts.minecraft,
    profile: opts.profile,
    ...(opts.xuid ? { xuid: opts.xuid } : {}),
    ...(opts.clientId ? { clientId: opts.clientId } : {})
  });
  return {
    accountId: opts.accountId,
    state: "SIGNED_IN",
    microsoft: opts.microsoft,
    minecraft: opts.minecraft,
    profile: opts.profile,
    entitlements: opts.entitlements,
    launchIdentity,
    createdAtMs: opts.createdAtMs
  };
}
