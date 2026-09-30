import { ErrorCode, LauncherError } from "../../core/errors/index.js";

/**
 * Secure persistence for Microsoft refresh tokens ONLY.
 * Never stores access/Xbox/XSTS/Minecraft tokens.
 */
export interface SecureRefreshTokenStore {
  readonly available: boolean;
  readonly kind: string;
  save(accountId: string, refreshToken: string): Promise<void>;
  load(accountId: string): Promise<string | null>;
  delete(accountId: string): Promise<void>;
  listAccountIds(): Promise<string[]>;
}

/** In-memory secure store for offline tests (never for production disk). */
export class MemorySecureRefreshTokenStore implements SecureRefreshTokenStore {
  readonly available = true;
  readonly kind = "memory";
  private readonly map = new Map<string, string>();

  async save(accountId: string, refreshToken: string): Promise<void> {
    assertAccountId(accountId);
    assertRefreshToken(refreshToken);
    this.map.set(accountId, refreshToken);
  }

  async load(accountId: string): Promise<string | null> {
    assertAccountId(accountId);
    return this.map.get(accountId) ?? null;
  }

  async delete(accountId: string): Promise<void> {
    assertAccountId(accountId);
    this.map.delete(accountId);
  }

  async listAccountIds(): Promise<string[]> {
    return [...this.map.keys()];
  }
}

/** Fail-closed store — never writes secrets to disk. */
export class UnavailableSecureRefreshTokenStore implements SecureRefreshTokenStore {
  readonly available = false;
  readonly kind = "unavailable";

  async save(): Promise<void> {
    throw new LauncherError(
      ErrorCode.AUTH_SECURE_STORAGE_UNAVAILABLE,
      "secure auth storage unavailable",
      {}
    );
  }

  async load(): Promise<string | null> {
    return null;
  }

  async delete(): Promise<void> {
    // no-op delete is safe
  }

  async listAccountIds(): Promise<string[]> {
    return [];
  }
}

function assertAccountId(accountId: string): void {
  if (!accountId || accountId.length > 200 || /[\r\n\0]/.test(accountId)) {
    throw new LauncherError(ErrorCode.AUTH_STORE_ERROR, "invalid accountId", {});
  }
}

function assertRefreshToken(token: string): void {
  if (!token || token.length > 16_384) {
    throw new LauncherError(ErrorCode.AUTH_STORE_ERROR, "invalid refresh token", {});
  }
}

export { assertAccountId, assertRefreshToken };
