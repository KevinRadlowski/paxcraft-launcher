import { Injectable, computed, signal } from '@angular/core';

import type {

  AppInfoDto,

  AuthState,

  AuthStateDto,

  InstallActiveOperation,

  InstallProgressDto,

  LauncherReadiness,

  LauncherStatusDto,

  UninstallMode,

  PlayStatusDto,

  SettingsDto,

  SafeAccountDto,

  UiError,

} from '@sweetcraft/ipc';

import type { AppState, DemoFixtureState, OperationState } from './models';

import { readinessAfterInstallProgress } from './install-progress-readiness';




/** Presentation-only settings defaults — not claimed as persisted backend settings. */

export const PRESENTATION_SETTINGS_DEFAULTS: SettingsDto = {

  language: 'fr',

  reducedMotion: false,

};



const DEFAULT_SERVER = 'sweetcraft.datho.st';



const MUTATION_OPS = new Set<InstallActiveOperation>([

  'INSTALLING',

  'UPDATING',

  'REPAIRING',

  'UNINSTALLING',

]);



@Injectable({ providedIn: 'root' })

export class AppStore {

  private readonly state = signal<AppState>({

    initialized: false,

    loading: true,

    error: null,

    info: null,

    status: null,

    accounts: [],

    settings: null,

    activeAccountId: null,

    operation: 'idle',

    authState: 'UNKNOWN',

    authError: null,

    authProgressKey: null,

    statusError: null,

    operationError: null,

    activeOperation: 'IDLE',

    installOperationStartedAt: null,

    installProgress: null,

    uninstallMode: null,

    playStatus: null,

    playError: null,

  });



  private readonly demoFixture = signal<DemoFixtureState | null>(null);

  private demoAllowed = false;



  readonly snapshot = this.state.asReadonly();



  readonly initialized = computed(() => this.state().initialized);

  readonly loading = computed(() => this.state().loading);

  readonly error = computed(() => this.state().error);

  readonly info = computed(() => this.state().info);

  readonly status = computed(() => this.state().status);

  readonly accounts = computed(() => this.state().accounts);

  readonly settings = computed(() => this.state().settings);

  readonly activeAccountId = computed(() => this.state().activeAccountId);

  readonly operation = computed(() => this.state().operation);

  readonly authError = computed(() => this.state().authError);

  readonly authProgressKey = computed(() => this.state().authProgressKey);

  readonly statusError = computed(() => this.state().statusError);

  readonly operationError = computed(() => this.state().operationError);

  readonly activeOperation = computed(() => this.state().activeOperation);

  readonly installProgress = computed(() => this.state().installProgress);

  readonly installOperationStartedAt = computed(() => this.state().installOperationStartedAt);

  readonly uninstallMode = computed(() => this.state().uninstallMode);

  readonly playStatus = computed(() => this.state().playStatus);

  readonly playError = computed(() => this.state().playError);

  readonly effectivePlayState = computed(() => this.state().playStatus?.state);

  readonly isPlayBusy = computed(() => {

    const state = this.state().playStatus?.state;

    return state === 'LAUNCHING' || state === 'RUNNING';

  });



  readonly effectiveReadiness = computed((): LauncherReadiness => {

    const demo = this.demoAllowed ? this.demoFixture() : null;

    if (demo) return demo.readiness;

    return this.state().status?.readiness ?? 'UNKNOWN';

  });



  readonly effectiveActiveOperation = computed((): InstallActiveOperation => {

    const demo = this.demoAllowed ? this.demoFixture() : null;

    if (demo) return 'IDLE';

    return this.state().status?.activeOperation ?? this.state().activeOperation;

  });



  readonly isInstallMutationBusy = computed(() => {

    const op = this.effectiveActiveOperation();

    return MUTATION_OPS.has(op) || this.effectiveReadiness() === 'BUSY';

  });



  readonly activeAccount = computed(() => {

    const id = this.state().activeAccountId;

    if (!id) return null;

    return this.state().accounts.find((a) => a.accountId === id) ?? null;

  });



  readonly effectiveAuthState = computed((): AuthState => {

    const demo = this.demoAllowed ? this.demoFixture() : null;

    if (demo) return demo.authState;

    return this.state().authState;

  });



  readonly serverAddress = computed(

    () => this.state().status?.serverAddress ?? DEFAULT_SERVER,

  );



  readonly effectiveSettings = computed((): SettingsDto => {

    return this.state().settings ?? PRESENTATION_SETTINGS_DEFAULTS;

  });



  setDemoAllowed(allowed: boolean): void {

    this.demoAllowed = allowed;

    if (!allowed) this.demoFixture.set(null);

  }



  setLoading(loading: boolean): void {

    this.state.update((s) => ({ ...s, loading }));

  }



  setError(error: string | null): void {

    this.state.update((s) => ({ ...s, error }));

  }



  /**
   * Clears sticky pack-check footer noise after a successful install.getStatus refresh.
   * - Always clears `error.network.pack_check`.
   * - Clears legacy sticky `error.network` only when launcher status is non-null:
   *   a successful refresh proves pack status is known, so a bootstrap HTTP sticky
   *   "Erreur réseau." must not linger while the shell is otherwise healthy.
   * Does NOT clear bridge-unavailable or `error.network.auth`.
   */
  clearPackNetworkFooterError(): void {
    this.state.update((s) => {
      if (s.error === 'error.network.pack_check') {
        return { ...s, error: null };
      }
      if (s.error === 'error.network' && s.status !== null) {
        return { ...s, error: null };
      }
      return s;
    });
  }



  setOperation(operation: OperationState): void {

    this.state.update((s) => ({ ...s, operation }));

  }



  setAppInfo(info: AppInfoDto): void {

    this.state.update((s) => ({ ...s, info }));

  }



  setLauncherStatus(status: LauncherStatusDto | null): void {

    if (status) {

      this.applyInstallStatus(status);

    } else {

      this.state.update((s) => ({ ...s, status: null }));

    }

  }



  setAccounts(accounts: SafeAccountDto[]): void {

    this.state.update((s) => {

      const stillValid =

        s.activeAccountId !== null &&

        accounts.some((a) => a.accountId === s.activeAccountId);

      return {

        ...s,

        accounts,

        activeAccountId: stillValid ? s.activeAccountId : null,

      };

    });

  }



  setSettings(settings: SettingsDto | null): void {

    this.state.update((s) => ({ ...s, settings }));

  }



  setInitialized(value: boolean): void {

    this.state.update((s) => ({ ...s, initialized: value }));

  }



  setStatusError(error: UiError | null): void {

    this.state.update((s) => ({ ...s, statusError: error }));

  }



  setOperationError(error: UiError | null): void {

    this.state.update((s) => ({ ...s, operationError: error }));

  }



  clearOperationError(): void {

    this.state.update((s) => ({ ...s, operationError: null }));

  }



  beginInstallOperation(active: InstallActiveOperation): void {

    this.state.update((s) => ({

      ...s,

      activeOperation: active,

      operationError: null,

      installProgress: null,

      installOperationStartedAt: Date.now(),

      status: s.status

        ? { ...s.status, readiness: 'BUSY', activeOperation: active, progress: undefined }

        : s.status,

    }));

  }



  setInstallProgress(progress: InstallProgressDto): void {

    this.state.update((s) => {

      if (!s.status) {

        return { ...s, installProgress: progress };

      }

      const active = s.status.activeOperation ?? s.activeOperation;

      const readiness = readinessAfterInstallProgress(

        s.status.readiness,

        active,

        progress.phase,

      );

      return {

        ...s,

        installProgress: progress,

        status: { ...s.status, progress, readiness },

      };

    });

  }



  setUninstallMode(mode: UninstallMode | null): void {

    this.state.update((s) => ({ ...s, uninstallMode: mode }));

  }



  setPlayError(error: UiError | null): void {

    this.state.update((s) => ({ ...s, playError: error }));

  }



  clearPlayError(): void {

    this.state.update((s) => ({ ...s, playError: null }));

  }



  applyPlayStatus(status: PlayStatusDto): void {

    this.state.update((s) => ({

      ...s,

      playStatus: status,

      playError:

        status.state === 'ERROR' && status.error

          ? status.error

          : status.state === 'LAUNCHING' || status.state === 'RUNNING'

            ? null

            : s.playError,

    }));

  }



  applyInstallStatus(status: LauncherStatusDto): void {

    this.state.update((s) => {

      const active = status.activeOperation ?? 'IDLE';

      const statusError =

        status.readiness === 'ERROR'

          ? {

              code: 'INSTALL_STATUS_ERROR',

              messageKey: status.messageKey ?? 'error.install.status_check',

            }

          : null;

      return {

        ...s,

        status,

        activeOperation: active,

        installProgress: status.progress ?? (active === 'IDLE' ? null : s.installProgress),

        installOperationStartedAt: active === 'IDLE' ? null : s.installOperationStartedAt,

        statusError,

        operationError:

          active === 'IDLE' && status.readiness !== 'BUSY' ? s.operationError : s.operationError,

      };

    });

  }



  setAuthRestoring(): void {

    this.state.update((s) => ({

      ...s,

      authState: 'RESTORING',

      authError: null,

      authProgressKey: 'auth.progress.restoring',

    }));

  }



  setAuthenticated(account: SafeAccountDto): void {

    this.state.update((s) => {

      const accounts = [

        account,

        ...s.accounts.filter((a) => a.accountId !== account.accountId),

      ];

      return {

        ...s,

        accounts,

        activeAccountId: account.accountId,

        authState: 'AUTHENTICATED',

        authError: null,

        authProgressKey: null,

      };

    });

  }



  setReauthRequired(error?: UiError | null): void {

    this.state.update((s) => ({

      ...s,

      authState: 'REAUTH_REQUIRED',

      authError: error ?? {

        code: 'AUTH_REAUTH_REQUIRED',

        messageKey: 'error.auth_reauth_required',

      },

      authProgressKey: null,

    }));

  }



  setSignedOut(): void {

    this.state.update((s) => ({

      ...s,

      authState: 'SIGNED_OUT',

      authError: null,

      authProgressKey: null,

    }));

  }



  setAuthError(error: UiError): void {

    this.state.update((s) => ({

      ...s,

      authState: 'ERROR',

      authError: error,

      authProgressKey: null,

    }));

  }



  selectAccount(accountId: string): void {

    this.state.update((s) => ({ ...s, activeAccountId: accountId }));

  }



  applyAuthStateDto(dto: AuthStateDto, accounts?: readonly SafeAccountDto[]): void {

    this.state.update((s) => {

      const nextAccounts = accounts ? [...accounts] : s.accounts;

      let activeAccountId = s.activeAccountId;

      if (dto.selectedAccountId !== undefined) {

        activeAccountId = dto.selectedAccountId;

      } else if (accounts) {

        const stillValid =

          s.activeAccountId !== null &&

          nextAccounts.some((a) => a.accountId === s.activeAccountId);

        activeAccountId = stillValid ? s.activeAccountId : null;

      }

      // Successful auth clears sticky auth-network footer (not pack_check / bridge).
      const footerError =
        dto.state === 'AUTHENTICATED' && s.error === 'error.network.auth' ? null : s.error;

      return {

        ...s,

        error: footerError,

        authState: dto.state,

        activeAccountId,

        authError: dto.error ?? null,

        accounts: nextAccounts,

        authProgressKey:

          dto.state === 'RESTORING'

            ? 'auth.progress.restoring'

            : dto.state === 'AUTHENTICATED' ||

                dto.state === 'SIGNED_OUT' ||

                dto.state === 'REAUTH_REQUIRED' ||

                dto.state === 'ERROR'

              ? null

              : s.authProgressKey,

      };

    });

  }



  setAuthProgressKey(key: string | null): void {

    this.state.update((s) => ({ ...s, authProgressKey: key }));

  }



  applyDemoFixture(fixture: DemoFixtureState | null): void {

    if (!this.demoAllowed) return;

    this.demoFixture.set(fixture);

  }



  readonly demoFixtureActive = computed(

    () => this.demoAllowed && this.demoFixture() !== null,

  );

}


