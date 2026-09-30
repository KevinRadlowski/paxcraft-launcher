import type { MicrosoftTokenSet } from "./oauth/exchange.js";
import type { MinecraftAccessToken, MinecraftEntitlements, MinecraftProfile } from "./minecraft/services.js";

/**
 * Persistable auth credentials — minimum necessary.
 * Intermediate Xbox/XSTS tokens are NOT persisted (short-lived, re-derivable).
 */
export interface PersistedAuthCredentials {
  accountId: string;
  microsoft: MicrosoftTokenSet;
  minecraft: MinecraftAccessToken;
  profile: MinecraftProfile;
  entitlements: MinecraftEntitlements;
  updatedAtMs: number;
}

export interface AuthTokenStore {
  load(accountId: string): Promise<PersistedAuthCredentials | null>;
  save(accountId: string, creds: PersistedAuthCredentials): Promise<void>;
  delete(accountId: string): Promise<void>;
  listAccountIds(): Promise<string[]>;
}

/**
 * In-memory store for tests. NEVER use for production refresh tokens.
 * Windows credential store is planned for 0.4B — no home-grown crypto here.
 */
export class InMemoryAuthTokenStore implements AuthTokenStore {
  private readonly map = new Map<string, PersistedAuthCredentials>();

  async load(accountId: string): Promise<PersistedAuthCredentials | null> {
    return this.map.get(accountId) ?? null;
  }

  async save(accountId: string, creds: PersistedAuthCredentials): Promise<void> {
    this.map.set(accountId, creds);
  }

  async delete(accountId: string): Promise<void> {
    this.map.delete(accountId);
  }

  async listAccountIds(): Promise<string[]> {
    return [...this.map.keys()];
  }
}

/**
 * Placeholder removed — use WindowsDpapiSecureRefreshTokenStore / SecureBackedAuthTokenStore (0.4B).
 */
export type WindowsCredentialAuthTokenStore = import("./secureStore/windowsDpapi.js").WindowsDpapiSecureRefreshTokenStore;
