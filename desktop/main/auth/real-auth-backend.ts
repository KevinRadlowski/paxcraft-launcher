/**
 * Real frozen-auth adapter for Electron Main.
 * Loads compiled `dist/auth` at runtime — does not rewrite the auth backend.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { AuthProgressPhase } from "../../shared/contract.js";
import { toUiError } from "../../shared/validate.js";
import type {
  AuthAccountRecord,
  AuthBackendLoginResult,
  AuthBackendPort
} from "./auth-desktop-service.js";
import { extractErrorCode, mapAuthCodeToUiError } from "./auth-errors.js";

export interface RealAuthBackendOptions {
  dataDir: string;
  /** Directory containing compiled `auth/` (usually repo `dist/` or app.asar/dist). */
  distRoot: string;
  /**
   * Packaged Electron production: LIVE Microsoft auth allowed without
   * SWEETCRAFT_ALLOW_LIVE_AUTH env gate.
   */
  packagedProduction?: boolean;
}

type AuthModule = {
  SystemClock: new () => { nowMs(): number };
  FileAccountRegistry: new (dataDir: string) => {
    list(): Promise<Array<{
      accountId: string;
      minecraftUsername: string;
      minecraftUuid: string;
      lastUsedAtMs: number;
    }>> | Array<{
      accountId: string;
      minecraftUsername: string;
      minecraftUuid: string;
      lastUsedAtMs: number;
    }>;
    get(accountId: string): Promise<{
      accountId: string;
      minecraftUsername: string;
      minecraftUuid: string;
      lastUsedAtMs: number;
    } | undefined> | {
      accountId: string;
      minecraftUsername: string;
      minecraftUuid: string;
      lastUsedAtMs: number;
    } | undefined;
  };
  createPlatformSecureRefreshTokenStore: (dataDir: string) => {
    kind: string;
    available: boolean;
    probe?: () => Promise<boolean>;
  };
  SecureBackedAuthTokenStore: new (
    secure: unknown,
    opts?: { persistRefresh: boolean }
  ) => unknown;
  InMemoryAuthTokenStore: new () => unknown;
  resolveLauncherAuthConfig: (opts?: { clientId?: string; env?: NodeJS.ProcessEnv }) => unknown;
  createOAuthConfigFromLauncherAuth: (cfg: unknown, redirectUri: string) => unknown;
  assertLiveAuthEnabled: (opts?: {
    env?: NodeJS.ProcessEnv;
    packagedProduction?: boolean;
    liveFlag?: boolean;
  }) => void;
  DefaultSystemBrowser: new () => { open(url: string): Promise<void> };
  FetchAuthHttpTransport: new () => unknown;
  signInInteractively: (deps: Record<string, unknown>) => Promise<{
    session: { accountId: string };
  }>;
  restoreAuthSession: (
    deps: unknown,
    accountId: string,
    opts?: { signal?: AbortSignal }
  ) => Promise<unknown>;
  logoutAccount: (
    deps: unknown,
    accountId: string,
    opts?: { deleteAccountMetadata?: boolean }
  ) => Promise<void>;
};

async function loadAuthModule(distRoot: string): Promise<AuthModule> {
  const href = pathToFileURL(path.join(distRoot, "auth", "index.js")).href;
  return import(href) as Promise<AuthModule>;
}

function recordFromAccount(a: {
  accountId: string;
  minecraftUsername: string;
  minecraftUuid: string;
  lastUsedAtMs: number;
}): AuthAccountRecord {
  return {
    accountId: a.accountId,
    minecraftUsername: a.minecraftUsername,
    minecraftUuid: a.minecraftUuid,
    lastUsedAtMs: a.lastUsedAtMs
  };
}

export async function createRealAuthBackend(
  opts: RealAuthBackendOptions
): Promise<AuthBackendPort> {
  const auth = await loadAuthModule(opts.distRoot);
  const clock = new auth.SystemClock();
  const accounts = new auth.FileAccountRegistry(opts.dataDir);
  const secure = auth.createPlatformSecureRefreshTokenStore(opts.dataDir);
  if (
    secure.kind === "windows-dpapi" &&
    "probe" in secure &&
    typeof (secure as { probe?: () => Promise<boolean> }).probe === "function"
  ) {
    await (secure as { probe: () => Promise<boolean> }).probe();
  }
  const store = new auth.SecureBackedAuthTokenStore(secure, {
    persistRefresh: secure.available
  });

  let browserOpens = 0;

  function pipelineDeps() {
    const launcherAuth = auth.resolveLauncherAuthConfig({ env: process.env });
    const config = auth.createOAuthConfigFromLauncherAuth(
      launcherAuth,
      "http://127.0.0.1/"
    );
    return {
      config,
      transport: new auth.FetchAuthHttpTransport(),
      clock,
      store,
      accounts
    };
  }

  const port: AuthBackendPort = {
    getBrowserOpenCount: () => browserOpens,

    async listAccounts() {
      const list = await Promise.resolve(accounts.list());
      return list.map(recordFromAccount);
    },

    async loginInteractive(loginOpts: {
      signal?: AbortSignal;
      onPhase?: (phase: AuthProgressPhase) => void;
    }): Promise<AuthBackendLoginResult> {
      const launcherAuth = auth.resolveLauncherAuthConfig({ env: process.env });
      try {
        auth.assertLiveAuthEnabled({
          env: process.env,
          ...(opts.packagedProduction === true ? { packagedProduction: true } : {})
        });
      } catch (e) {
        throw mapAuthCodeToUiError(extractErrorCode(e));
      }

      const browser = {
        open: async (url: string) => {
          browserOpens += 1;
          await new auth.DefaultSystemBrowser().open(url);
        }
      };

      loginOpts.onPhase?.("OPENING_BROWSER");
      loginOpts.onPhase?.("WAITING_FOR_CALLBACK");

      try {
        const result = await auth.signInInteractively({
          launcherAuth,
          browser,
          clock,
          store,
          accounts,
          secureStore: secure,
          persistRefresh: secure.available,
          transport: new auth.FetchAuthHttpTransport(),
          ...(loginOpts.signal ? { signal: loginOpts.signal } : {})
        });
        loginOpts.onPhase?.("CHECKING_ENTITLEMENT");
        loginOpts.onPhase?.("LOADING_PROFILE");
        loginOpts.onPhase?.("AUTHENTICATED");
        const rec = await Promise.resolve(accounts.get(result.session.accountId));
        if (!rec) throw toUiError("AUTH_SESSION_ERROR", "error.auth_error");
        return { account: recordFromAccount(rec) };
      } catch (e) {
        throw mapAuthCodeToUiError(extractErrorCode(e));
      }
    },

    async restore(accountId, restoreOpts) {
      try {
        await auth.restoreAuthSession(
          pipelineDeps(),
          accountId,
          restoreOpts?.signal ? { signal: restoreOpts.signal } : {}
        );
        const rec = await Promise.resolve(accounts.get(accountId));
        if (!rec) {
          throw toUiError("AUTH_ACCOUNT_NOT_FOUND", "error.auth_account_required");
        }
        return { account: recordFromAccount(rec) };
      } catch (e) {
        throw mapAuthCodeToUiError(extractErrorCode(e));
      }
    },

    async logout(accountId) {
      try {
        await auth.logoutAccount(pipelineDeps(), accountId, {
          deleteAccountMetadata: true
        });
      } catch (e) {
        throw mapAuthCodeToUiError(extractErrorCode(e));
      }
    }
  };

  return port;
}
