import type { AuthTokenStore, PersistedAuthCredentials } from "../store.js";
import { InMemoryAuthTokenStore } from "../store.js";
import type { SecureRefreshTokenStore } from "./types.js";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";

/**
 * AuthTokenStore that:
 * - keeps full session credentials in memory (volatile)
 * - persists ONLY microsoft.refreshToken via SecureRefreshTokenStore
 * - never writes access/Xbox/XSTS/Minecraft tokens to disk
 *
 * Save order when persistRefresh=true:
 *   1) secure.save(refresh) first
 *   2) memory.save only after secure success
 * If secure.save fails: throw, no plaintext, memory not updated for this save.
 */
export class SecureBackedAuthTokenStore implements AuthTokenStore {
  private readonly memory = new InMemoryAuthTokenStore();

  constructor(
    private readonly secure: SecureRefreshTokenStore,
    private readonly opts: { persistRefresh: boolean } = { persistRefresh: true }
  ) {}

  async load(accountId: string): Promise<PersistedAuthCredentials | null> {
    const mem = await this.memory.load(accountId);
    if (mem) return mem;
    const refresh = await this.secure.load(accountId);
    if (!refresh) return null;
    return {
      accountId,
      microsoft: {
        accessToken: "",
        refreshToken: refresh,
        tokenType: "Bearer",
        expiresAtMs: 0
      },
      minecraft: { accessToken: "", expiresAtMs: 0 },
      profile: { id: "", name: "" },
      entitlements: { items: [], ownsMinecraftJava: false },
      updatedAtMs: 0
    };
  }

  async save(accountId: string, creds: PersistedAuthCredentials): Promise<void> {
    const refresh = creds.microsoft.refreshToken;
    if (refresh && this.opts.persistRefresh) {
      if (!this.secure.available) {
        throw new LauncherError(
          ErrorCode.AUTH_SECURE_STORAGE_UNAVAILABLE,
          "cannot persist refresh token: secure storage unavailable",
          {}
        );
      }
      // Secure first — fail closed before considering persistence successful
      await this.secure.save(accountId, refresh);
    }
    await this.memory.save(accountId, creds);
  }

  async delete(accountId: string): Promise<void> {
    await this.memory.delete(accountId);
    await this.secure.delete(accountId);
  }

  async listAccountIds(): Promise<string[]> {
    const mem = await this.memory.listAccountIds();
    const disk = await this.secure.listAccountIds();
    return [...new Set([...mem, ...disk])];
  }

  get secureStore(): SecureRefreshTokenStore {
    return this.secure;
  }
}
