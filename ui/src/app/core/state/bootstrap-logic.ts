import type {
  AccountSummaryDto,
  AppInfoDto,
  AuthState,
  LauncherReadiness,
  LauncherStatusDto,
  SafeAccountDto,
  SettingsDto,
} from '@sweetcraft/ipc';
import { resolveErrorMessageKey } from '../errors/error-messages.js';

export interface BootstrapStore {
  initialized(): boolean;
  setLoading(loading: boolean): void;
  setError(error: string | null): void;
  setDemoAllowed(allowed: boolean): void;
  setAppInfo(info: AppInfoDto): void;
  setLauncherStatus(status: LauncherStatusDto | null): void;
  setAccounts(accounts: SafeAccountDto[]): void;
  setSettings(settings: SettingsDto | null): void;
  setInitialized(value: boolean): void;
  setAuthRestoring?(): void;
  setSignedOut?(): void;
  applyAuthStateDto?(
    dto: {
      state: AuthState;
      selectedAccountId?: string;
      account?: SafeAccountDto;
      error?: { code: string; messageKey: string };
    },
    accounts?: readonly SafeAccountDto[],
  ): void;
}

export interface BootstrapSources {
  kind: 'dev' | 'electron';
  getInfo(): Promise<AppInfoDto>;
  getStatus(): Promise<LauncherStatusDto>;
  listAccounts(): Promise<SafeAccountDto[]>;
  getSettings(): Promise<SettingsDto>;
  getAuthState?(): Promise<{
    state: AuthState;
    selectedAccountId?: string;
    account?: SafeAccountDto;
    error?: { code: string; messageKey: string };
  }>;
  restoreAuth?(): Promise<{
    state: {
      state: AuthState;
      selectedAccountId?: string;
      account?: SafeAccountDto;
      error?: { code: string; messageKey: string };
    };
    accounts: readonly SafeAccountDto[];
  }>;
}

function errorCode(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    return String((err as { code: unknown }).code);
  }
  return 'BOOTSTRAP_FAILED';
}

/** Auth restore failures that are network/HTTP — sticky footer key distinct from pack check. */
export function isAuthNetworkFailureCode(code: string): boolean {
  const c = code.toUpperCase();
  return (
    c === 'NETWORK' ||
    c === 'NETWORK_ERROR' ||
    c === 'HTTP' ||
    c === 'HTTP_ERROR' ||
    c === 'HTTP_TIMEOUT' ||
    c.startsWith('AUTH_HTTP_')
  );
}

/** Partial bootstrap + optional one-shot auth restore (never opens browser). */
export async function runBootstrap(
  store: BootstrapStore,
  sources: BootstrapSources,
): Promise<void> {
  if (store.initialized()) return;
  store.setLoading(true);
  store.setError(null);
  store.setDemoAllowed(sources.kind === 'dev');

  const warnings: string[] = [];

  const infoResult = await Promise.resolve(sources.getInfo()).then(
    (v) => ({ ok: true as const, value: v }),
    (e: unknown) => ({ ok: false as const, error: e }),
  );
  const statusResult = await Promise.resolve(sources.getStatus()).then(
    (v) => ({ ok: true as const, value: v }),
    (e: unknown) => ({ ok: false as const, error: e }),
  );
  const accountsResult = await Promise.resolve(sources.listAccounts()).then(
    (v) => ({ ok: true as const, value: v }),
    (e: unknown) => ({ ok: false as const, error: e }),
  );
  const settingsResult = await Promise.resolve(sources.getSettings()).then(
    (v) => ({ ok: true as const, value: v }),
    (e: unknown) => ({ ok: false as const, error: e }),
  );

  if (infoResult.ok) store.setAppInfo(infoResult.value);
  else warnings.push(resolveErrorMessageKey(errorCode(infoResult.error)));

  if (statusResult.ok) store.setLauncherStatus(statusResult.value);
  else {
    store.setLauncherStatus(null);
    // Sticky pack-check key — not generic error.network (MC ping never clears AppStore.error).
    warnings.push('error.network.pack_check');
  }

  if (accountsResult.ok) store.setAccounts(accountsResult.value);
  else {
    store.setAccounts([]);
    warnings.push(resolveErrorMessageKey(errorCode(accountsResult.error)));
  }

  if (settingsResult.ok) store.setSettings(settingsResult.value);
  else {
    store.setSettings(null);
    warnings.push(resolveErrorMessageKey(errorCode(settingsResult.error)));
  }

  // Auth restore — at most one attempt; never opens browser.
  if (sources.restoreAuth && accountsResult.ok) {
    store.setAuthRestoring?.();
    try {
      const restored = await sources.restoreAuth();
      store.applyAuthStateDto?.(restored.state, restored.accounts);
      store.setAccounts([...restored.accounts]);
    } catch (e) {
      store.setSignedOut?.();
      const code = errorCode(e);
      warnings.push(
        isAuthNetworkFailureCode(code) ? 'error.network.auth' : resolveErrorMessageKey(code),
      );
    }
  } else if (sources.getAuthState) {
    try {
      const st = await sources.getAuthState();
      store.applyAuthStateDto?.(st, accountsResult.ok ? accountsResult.value : []);
    } catch {
      store.setSignedOut?.();
    }
  } else if (!accountsResult.ok || accountsResult.value.length === 0) {
    store.setSignedOut?.();
  }

  const hasAny =
    infoResult.ok || statusResult.ok || accountsResult.ok || settingsResult.ok;
  const bridgeDown =
    !infoResult.ok && errorCode(infoResult.error) === 'DESKTOP_BRIDGE_UNAVAILABLE';

  store.setInitialized(true);
  if (bridgeDown && !hasAny) {
    store.setError(resolveErrorMessageKey('DESKTOP_BRIDGE_UNAVAILABLE'));
  } else if (!infoResult.ok && warnings.length) {
    store.setError(warnings[0]!);
  } else if (warnings.length && infoResult.ok) {
    store.setError(warnings[0]!);
  }

  store.setLoading(false);
}

export type { AuthState, LauncherReadiness, AccountSummaryDto };
