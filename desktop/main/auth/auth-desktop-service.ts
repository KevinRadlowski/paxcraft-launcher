import type {
  AuthActionResultDto,
  AuthProgressDto,
  AuthProgressPhase,
  AuthState,
  AuthStateDto,
  SafeAccountDto,
  UiError
} from "../../shared/contract.js";
import { toUiError } from "../../shared/validate.js";
import {
  authStateForErrorCode,
  extractErrorCode,
  mapAuthCodeToUiError
} from "./auth-errors.js";
import { normalizeSafeAccount } from "./auth-dto.js";

/** Account record as seen by the desktop adapter (safe metadata only). */
export interface AuthAccountRecord {
  accountId: string;
  minecraftUsername: string;
  minecraftUuid?: string;
  lastUsedAtMs: number;
}

export interface AuthBackendLoginResult {
  account: AuthAccountRecord;
}

export interface AuthBackendPort {
  listAccounts(): Promise<AuthAccountRecord[]>;
  /** Interactive login — may open system browser. Never called from restore. */
  loginInteractive(opts: {
    signal?: AbortSignal;
    onPhase?: (phase: AuthProgressPhase) => void;
  }): Promise<AuthBackendLoginResult>;
  /** Cold restore / refresh — must NOT open browser. */
  restore(accountId: string, opts?: { signal?: AbortSignal }): Promise<AuthBackendLoginResult>;
  logout(accountId: string): Promise<void>;
  /** Test/observability: browser opens during interactive login. */
  getBrowserOpenCount?(): number;
}

export type AuthEventSink = {
  onState(state: AuthStateDto): void;
  onProgress(progress: AuthProgressDto): void;
  onWarning?: (warning: UiError) => void;
};

function toSafe(a: AuthAccountRecord): SafeAccountDto {
  return normalizeSafeAccount({
    accountId: a.accountId,
    minecraftUsername: a.minecraftUsername,
    ...(a.minecraftUuid ? { minecraftUuid: a.minecraftUuid } : {}),
    ...(a.lastUsedAtMs > 0 ? { lastUsedAtMs: a.lastUsedAtMs } : {})
  });
}

/**
 * Deterministic account selection (mirrors frozen resolvePlayAccount).
 * Never picks arbitrarily among multiple accounts.
 */
export function resolveDeterministicAccount(
  accounts: readonly AuthAccountRecord[],
  accountId?: string
): AuthAccountRecord {
  if (accountId) {
    const found = accounts.find((a) => a.accountId === accountId);
    if (!found) {
      throw toUiError("AUTH_ACCOUNT_NOT_FOUND", "error.auth_account_required");
    }
    return found;
  }
  if (accounts.length === 0) {
    throw toUiError("AUTH_ACCOUNT_REQUIRED", "error.auth_account_required");
  }
  if (accounts.length === 1) return accounts[0]!;

  const withLastUsed = accounts
    .filter((a) => a.lastUsedAtMs > 0)
    .slice()
    .sort((a, b) => b.lastUsedAtMs - a.lastUsedAtMs);

  if (withLastUsed.length === 0) {
    throw toUiError("AUTH_ACCOUNT_REQUIRED", "error.auth_account_required");
  }
  const top = withLastUsed[0]!;
  const tied = withLastUsed.filter((a) => a.lastUsedAtMs === top.lastUsedAtMs);
  if (tied.length !== 1) {
    throw toUiError("AUTH_ACCOUNT_REQUIRED", "error.auth_account_required");
  }
  return top;
}

type AuthOp = "idle" | "select" | "restore" | "login" | "logout";

const AUTH_PHASE_MESSAGE_KEYS: Partial<Record<AuthProgressPhase, string>> = {
  STARTING: "auth.progress.starting",
  OPENING_BROWSER: "auth.progress.opening_browser",
  WAITING_FOR_CALLBACK: "auth.progress.waiting_for_callback",
  MICROSOFT_AUTHENTICATED: "auth.progress.microsoft_authenticated",
  XBOX_AUTHENTICATING: "auth.progress.xbox_authenticating",
  MINECRAFT_AUTHENTICATING: "auth.progress.minecraft_authenticating",
  CHECKING_ENTITLEMENT: "auth.progress.checking_entitlement",
  LOADING_PROFILE: "auth.progress.loading_profile",
  RESTORING: "auth.progress.restoring",
  AUTHENTICATED: "auth.progress.authenticated"
};

export class AuthDesktopService {
  private op: AuthOp = "idle";
  /** UI / intended account selection — not session proof. */
  private selectedAccountId: string | null = null;
  /** Account whose session was actually validated. */
  private authenticatedAccountId: string | null = null;
  private authenticatedAccount: AuthAccountRecord | null = null;
  private state: AuthState = "UNKNOWN";
  private lastError: AuthStateDto["error"];
  private abort: AbortController | null = null;

  constructor(
    private readonly backend: AuthBackendPort,
    private readonly sink?: AuthEventSink
  ) {}

  getBrowserOpenCount(): number {
    return this.backend.getBrowserOpenCount?.() ?? 0;
  }

  /** Test/observability helpers */
  getAuthenticatedAccountId(): string | null {
    return this.authenticatedAccountId;
  }

  getSelectedAccountId(): string | null {
    return this.selectedAccountId;
  }

  async listAccounts(): Promise<SafeAccountDto[]> {
    const list = await this.backend.listAccounts();
    return list.map(toSafe);
  }

  getState(): AuthStateDto {
    return this.buildStateDto();
  }

  /**
   * When AUTHENTICATED, DTO selectedAccountId/account always align with
   * authenticatedAccountId (never the unvalidated selection alone).
   */
  private buildStateDto(accountOverride?: AuthAccountRecord | null): AuthStateDto {
    const dto: {
      state: AuthState;
      selectedAccountId?: string;
      account?: SafeAccountDto;
      error?: NonNullable<AuthStateDto["error"]>;
    } = { state: this.state };

    if (this.state === "AUTHENTICATED" && this.authenticatedAccountId) {
      dto.selectedAccountId = this.authenticatedAccountId;
      const account = accountOverride ?? this.authenticatedAccount;
      if (account) dto.account = toSafe(account);
    } else {
      if (this.selectedAccountId) dto.selectedAccountId = this.selectedAccountId;
      if (accountOverride) dto.account = toSafe(accountOverride);
    }

    if (this.lastError) {
      dto.error = this.lastError;
    }
    return dto;
  }

  private emitState(account?: AuthAccountRecord | null): AuthStateDto {
    const dto = this.buildStateDto(account);
    this.sink?.onState(dto);
    return dto;
  }

  private emitProgress(phase: AuthProgressPhase, messageKey?: string): void {
    const key = messageKey ?? AUTH_PHASE_MESSAGE_KEYS[phase];
    const p: AuthProgressDto = key ? { phase, messageKey: key } : { phase };
    this.sink?.onProgress(p);
  }

  private clearAuthenticatedSession(): void {
    this.authenticatedAccountId = null;
    this.authenticatedAccount = null;
  }

  private setAuthenticatedSession(account: AuthAccountRecord): void {
    this.authenticatedAccountId = account.accountId;
    this.authenticatedAccount = { ...account };
    this.selectedAccountId = account.accountId;
    this.state = "AUTHENTICATED";
    this.lastError = undefined;
  }

  /**
   * Auth success is authoritative. Account-list refresh is best-effort.
   */
  private async buildActionResult(
    knownAccount?: AuthAccountRecord | null
  ): Promise<AuthActionResultDto> {
    const state = this.emitState(knownAccount ?? this.authenticatedAccount);
    let accounts: SafeAccountDto[];
    try {
      accounts = await this.listAccounts();
    } catch {
      const fallback: AuthAccountRecord[] = [];
      if (this.authenticatedAccount) fallback.push(this.authenticatedAccount);
      else if (knownAccount) fallback.push(knownAccount);
      accounts = fallback.map(toSafe);
      this.sink?.onWarning?.(
        toUiError("AUTH_ACCOUNT_METADATA_WARNING", "error.auth_account_metadata_warning")
      );
    }
    return { state, accounts };
  }

  private beginOp(kind: Exclude<AuthOp, "idle">): void {
    if (this.op !== "idle") {
      throw toUiError("AUTH_OPERATION_BUSY", "error.auth_operation_busy");
    }
    this.op = kind;
  }

  private endOp(): void {
    this.op = "idle";
    this.abort = null;
  }

  /**
   * Selection alone never authenticates.
   * Selecting a different account than the validated session → SIGNED_OUT.
   */
  async select(accountId: string): Promise<AuthActionResultDto> {
    this.beginOp("select");
    try {
      const accounts = await this.backend.listAccounts();
      const found = accounts.find((a) => a.accountId === accountId);
      if (!found) {
        throw toUiError("AUTH_ACCOUNT_NOT_FOUND", "error.auth_account_required");
      }

      const previouslyAuthenticatedId = this.authenticatedAccountId;
      this.selectedAccountId = found.accountId;

      if (
        this.state === "AUTHENTICATED" &&
        previouslyAuthenticatedId !== null &&
        previouslyAuthenticatedId === found.accountId
      ) {
        // Re-selecting the already-validated account — keep AUTHENTICATED.
        return this.buildActionResult(this.authenticatedAccount);
      }

      // Different account (or no validated session): selection is not auth.
      this.clearAuthenticatedSession();
      this.state = "SIGNED_OUT";
      this.lastError = undefined;
      return this.buildActionResult(found);
    } finally {
      this.endOp();
    }
  }

  /**
   * Cold restore — never opens browser.
   * Pre-auth listAccounts failure prevents restore (required precondition).
   * Post-auth list refresh failure does not fail auth.
   */
  async restore(accountId?: string): Promise<AuthActionResultDto> {
    this.beginOp("restore");
    this.abort = new AbortController();
    try {
      let accounts: AuthAccountRecord[];
      try {
        accounts = await this.backend.listAccounts();
      } catch (e) {
        this.state = "ERROR";
        this.lastError = mapAuthCodeToUiError(extractErrorCode(e));
        this.clearAuthenticatedSession();
        return this.buildActionResult(null);
      }

      if (accounts.length === 0) {
        this.selectedAccountId = null;
        this.clearAuthenticatedSession();
        this.state = "SIGNED_OUT";
        this.lastError = undefined;
        return this.buildActionResult(null);
      }

      let target: AuthAccountRecord;
      try {
        target = resolveDeterministicAccount(accounts, accountId);
      } catch (e) {
        this.state = "SIGNED_OUT";
        this.lastError = mapAuthCodeToUiError(extractErrorCode(e));
        this.clearAuthenticatedSession();
        return this.buildActionResult(null);
      }

      this.selectedAccountId = target.accountId;
      this.clearAuthenticatedSession();
      this.state = "RESTORING";
      this.lastError = undefined;
      this.emitState(target);
      this.emitProgress("RESTORING", "auth.progress.restoring");

      try {
        const logged = await this.backend.restore(target.accountId, {
          signal: this.abort.signal
        });
        this.setAuthenticatedSession(logged.account);
        this.emitProgress("AUTHENTICATED", "auth.progress.authenticated");
        return this.buildActionResult(logged.account);
      } catch (e) {
        const code = extractErrorCode(e);
        this.state = authStateForErrorCode(code);
        this.lastError = mapAuthCodeToUiError(code);
        this.clearAuthenticatedSession();
        this.emitProgress("FAILED", this.lastError.messageKey);
        return this.buildActionResult(target);
      }
    } finally {
      this.endOp();
    }
  }

  /** Explicit user login — may open system browser via frozen backend. */
  async login(): Promise<AuthActionResultDto> {
    this.beginOp("login");
    this.abort = new AbortController();
    try {
      this.state = "RESTORING";
      this.lastError = undefined;
      this.clearAuthenticatedSession();
      this.emitState();
      this.emitProgress("STARTING", "auth.progress.starting");
      this.emitProgress("OPENING_BROWSER", "auth.progress.opening_browser");

      try {
        const logged = await this.backend.loginInteractive({
          signal: this.abort.signal,
          onPhase: (phase) => this.emitProgress(phase)
        });
        this.setAuthenticatedSession(logged.account);
        this.emitProgress("AUTHENTICATED", "auth.progress.authenticated");
        return this.buildActionResult(logged.account);
      } catch (e) {
        const code = extractErrorCode(e);
        this.state = authStateForErrorCode(code);
        this.lastError = mapAuthCodeToUiError(code);
        this.clearAuthenticatedSession();
        this.emitProgress("FAILED", this.lastError.messageKey);
        return this.buildActionResult(null);
      }
    } finally {
      this.endOp();
    }
  }

  async logout(accountId: string): Promise<AuthActionResultDto> {
    this.beginOp("logout");
    try {
      const wasAuthenticated = this.authenticatedAccountId === accountId;
      await this.backend.logout(accountId);

      if (wasAuthenticated) {
        this.clearAuthenticatedSession();
        this.state = "SIGNED_OUT";
        this.lastError = undefined;
        this.selectedAccountId = null;
      }

      let remaining: AuthAccountRecord[] = [];
      try {
        remaining = await this.backend.listAccounts();
      } catch {
        remaining = [];
        this.sink?.onWarning?.(
          toUiError("AUTH_ACCOUNT_METADATA_WARNING", "error.auth_account_metadata_warning")
        );
      }

      if (wasAuthenticated) {
        // Remaining accounts may become selected metadata only — never auto-AUTHENTICATED.
        if (remaining.length === 1) {
          this.selectedAccountId = remaining[0]!.accountId;
        } else if (remaining.length > 1) {
          try {
            this.selectedAccountId = resolveDeterministicAccount(remaining).accountId;
          } catch {
            this.selectedAccountId = null;
          }
        }
        return this.buildActionResult(null);
      }

      // Logged out a non-authenticated saved account — keep A authenticated.
      if (this.selectedAccountId === accountId) {
        this.selectedAccountId = this.authenticatedAccountId;
      }
      return this.buildActionResult(this.authenticatedAccount);
    } finally {
      this.endOp();
    }
  }
}
