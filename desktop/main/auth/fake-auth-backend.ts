import type { AuthProgressPhase } from "../../shared/contract.js";
import { toUiError } from "../../shared/validate.js";
import type {
  AuthAccountRecord,
  AuthBackendLoginResult,
  AuthBackendPort
} from "./auth-desktop-service.js";
import type { FakeAuthFixtureId } from "./fake-auth-store.js";
import {
  clearFakeAuthStore,
  fromPersisted,
  loadFakeAuthStore,
  saveFakeAuthStore,
  toPersisted
} from "./fake-auth-store.js";

export type FakeAuthScenario =
  | "success"
  | "missing_credential"
  | "invalid_grant"
  | "transient_error"
  | "appid_blocked"
  | "not_owned"
  | "account_mismatch"
  | "suspended";

export interface FakeAuthBackendOptions {
  /** When set, accounts/credentials persist across process restarts (dev only). */
  readonly persistDir?: string;
}

/**
 * In-memory auth backend for offline desktop tests / unpackaged fake harness.
 * Never carries real tokens — only safe metadata + scenario switches.
 * Optional persistDir stores fake account markers only (not DPAPI / AccountRegistry).
 */
export class FakeAuthBackend implements AuthBackendPort {
  private accounts: AuthAccountRecord[] = [];
  private credentials = new Set<string>();
  private browserOpens = 0;
  private interactiveLoginAttempts = 0;
  loginScenario: FakeAuthScenario = "success";
  restoreScenario: FakeAuthScenario = "success";
  /** Process-only — never persisted. Fresh backend defaults to SUCCESS. */
  currentFixture: FakeAuthFixtureId = "SUCCESS";
  restoreDelayMs = 0;
  loginDelayMs = 0;
  logoutDelayMs = 0;
  listAccountsDelayMs = 0;
  /** 1-based call index that should fail; null = never. */
  failOnListAccountsCall: number | null = null;
  private listAccountsCalls = 0;
  private readonly persistDir: string | null;

  constructor(opts?: FakeAuthBackendOptions) {
    this.persistDir = opts?.persistDir ?? null;
    if (this.persistDir) this.reloadFromDisk();
  }

  private reloadFromDisk(): void {
    if (!this.persistDir) return;
    const store = loadFakeAuthStore(this.persistDir);
    this.accounts = store.accounts.map(fromPersisted);
    this.credentials = new Set(
      store.accounts.filter((a) => a.restorable).map((a) => a.accountId)
    );
  }

  private persist(): void {
    if (!this.persistDir) return;
    saveFakeAuthStore(this.persistDir, {
      schemaVersion: 1,
      accounts: this.accounts.map((a) => toPersisted(a, this.credentials.has(a.accountId)))
    });
  }

  seedAccount(
    account: AuthAccountRecord,
    opts?: { withCredential?: boolean }
  ): void {
    this.accounts = this.accounts.filter((a) => a.accountId !== account.accountId);
    this.accounts.push(account);
    if (opts?.withCredential !== false) {
      this.credentials.add(account.accountId);
    } else {
      this.credentials.delete(account.accountId);
    }
    this.persist();
  }

  clear(): void {
    this.accounts = [];
    this.credentials.clear();
    this.browserOpens = 0;
    this.interactiveLoginAttempts = 0;
    this.failOnListAccountsCall = null;
    this.listAccountsCalls = 0;
    this.applyFixture("SUCCESS");
    if (this.persistDir) clearFakeAuthStore(this.persistDir);
  }

  getBrowserOpenCount(): number {
    // Fake backend never opens a real system browser.
    return this.browserOpens;
  }

  getInteractiveLoginAttemptCount(): number {
    return this.interactiveLoginAttempts;
  }

  getCurrentFixture(): FakeAuthFixtureId {
    return this.currentFixture;
  }

  /** Apply Diagnostics / acceptance fixture (dev harness only). Process-only. */
  applyFixture(fixture: FakeAuthFixtureId): void {
    this.currentFixture = fixture;
    switch (fixture) {
      case "SUCCESS":
        this.loginScenario = "success";
        this.restoreScenario = "success";
        break;
      case "REAUTH_REQUIRED":
        this.loginScenario = "invalid_grant";
        this.restoreScenario = "invalid_grant";
        break;
      case "APPID_BLOCKED":
        this.loginScenario = "appid_blocked";
        this.restoreScenario = "appid_blocked";
        break;
      case "NOT_OWNED":
        this.loginScenario = "not_owned";
        this.restoreScenario = "not_owned";
        break;
      case "ERROR":
        this.loginScenario = "transient_error";
        this.restoreScenario = "transient_error";
        break;
    }
  }

  async listAccounts(): Promise<AuthAccountRecord[]> {
    if (this.listAccountsDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.listAccountsDelayMs));
    }
    this.listAccountsCalls += 1;
    if (this.failOnListAccountsCall === this.listAccountsCalls) {
      throw toUiError("AUTH_HTTP_TIMEOUT", "error.network");
    }
    return this.accounts.map((a) => ({ ...a }));
  }

  async loginInteractive(opts: {
    signal?: AbortSignal;
    onPhase?: (phase: AuthProgressPhase) => void;
  }): Promise<AuthBackendLoginResult> {
    if (opts.signal?.aborted) {
      throw toUiError("AUTH_REQUEST_ABORTED", "error.auth_aborted");
    }
    if (this.loginDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.loginDelayMs));
    }
    // Fake mode never opens a real browser — do not increment browserOpens.
    this.interactiveLoginAttempts += 1;
    opts.onPhase?.("WAITING_FOR_CALLBACK");
    opts.onPhase?.("MICROSOFT_AUTHENTICATED");
    opts.onPhase?.("XBOX_AUTHENTICATING");
    opts.onPhase?.("MINECRAFT_AUTHENTICATING");
    opts.onPhase?.("CHECKING_ENTITLEMENT");
    opts.onPhase?.("LOADING_PROFILE");

    switch (this.loginScenario) {
      case "appid_blocked":
        throw toUiError("MINECRAFT_APP_NOT_AUTHORIZED", "error.minecraft_app_not_authorized");
      case "not_owned":
        throw toUiError("MINECRAFT_NOT_OWNED", "error.minecraft_not_owned");
      case "suspended":
        throw toUiError("MINECRAFT_ACCOUNT_SUSPENDED", "error.minecraft_account_suspended");
      case "account_mismatch":
        throw toUiError("AUTH_ACCOUNT_MISMATCH", "error.auth_account_mismatch");
      case "transient_error":
        throw toUiError("AUTH_HTTP_TIMEOUT", "error.network");
      case "invalid_grant":
        throw toUiError("AUTH_REAUTH_REQUIRED", "error.auth_reauth_required");
      case "missing_credential":
        throw toUiError("AUTH_LOGIN_REQUIRED", "error.auth_login_required");
      default:
        break;
    }

    const account: AuthAccountRecord = {
      accountId: "mc:11111111-1111-1111-1111-111111111111",
      minecraftUsername: "JoueurDemo",
      minecraftUuid: "11111111-1111-1111-1111-111111111111",
      lastUsedAtMs: Date.now()
    };
    this.seedAccount(account, { withCredential: true });
    return { account };
  }

  async restore(
    accountId: string,
    opts?: { signal?: AbortSignal }
  ): Promise<AuthBackendLoginResult> {
    if (opts?.signal?.aborted) {
      throw toUiError("AUTH_REQUEST_ABORTED", "error.auth_aborted");
    }
    if (this.restoreDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.restoreDelayMs));
    }
    const account = this.accounts.find((a) => a.accountId === accountId);
    if (!account) {
      throw toUiError("AUTH_ACCOUNT_NOT_FOUND", "error.auth_account_required");
    }
    if (!this.credentials.has(accountId)) {
      throw toUiError("AUTH_LOGIN_REQUIRED", "error.auth_login_required");
    }
    switch (this.restoreScenario) {
      case "invalid_grant":
        this.credentials.delete(accountId);
        this.persist();
        throw toUiError("AUTH_REAUTH_REQUIRED", "error.auth_reauth_required");
      case "transient_error":
        throw toUiError("AUTH_HTTP_TIMEOUT", "error.network");
      case "appid_blocked":
        throw toUiError("MINECRAFT_APP_NOT_AUTHORIZED", "error.minecraft_app_not_authorized");
      case "account_mismatch":
        throw toUiError("AUTH_ACCOUNT_MISMATCH", "error.auth_account_mismatch");
      case "missing_credential":
        throw toUiError("AUTH_LOGIN_REQUIRED", "error.auth_login_required");
      case "not_owned":
        throw toUiError("MINECRAFT_NOT_OWNED", "error.minecraft_not_owned");
      default:
        break;
    }
    return { account: { ...account } };
  }

  async logout(accountId: string): Promise<void> {
    if (this.logoutDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.logoutDelayMs));
    }
    this.credentials.delete(accountId);
    this.accounts = this.accounts.filter((a) => a.accountId !== accountId);
    this.persist();
  }

  hasCredential(accountId: string): boolean {
    return this.credentials.has(accountId);
  }
}

/**
 * Packaged soft-fail shell backend — not FakeAuthBackend.
 * Empty accounts; interactive login refused.
 */
export class EmptyAuthBackend implements AuthBackendPort {
  async listAccounts(): Promise<AuthAccountRecord[]> {
    return [];
  }

  async loginInteractive(): Promise<AuthBackendLoginResult> {
    throw toUiError("LIVE_AUTH_NOT_ENABLED", "error.auth_live_disabled");
  }

  async restore(): Promise<AuthBackendLoginResult> {
    throw toUiError("AUTH_LOGIN_REQUIRED", "error.auth_login_required");
  }

  async logout(): Promise<void> {
    // no-op
  }

  getBrowserOpenCount(): number {
    return 0;
  }
}
