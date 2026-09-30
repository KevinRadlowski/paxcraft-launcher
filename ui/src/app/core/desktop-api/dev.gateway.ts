import type { LauncherDesktopGateway } from './gateway';

import type {

  AppInfoDto,

  AuthActionResultDto,

  AuthProgressDto,

  AuthState,

  AuthStateDto,

  InstallActiveOperation,

  InstallProgressDto,

  InstallProgressPhase,

  LauncherReadiness,

  LauncherStatusDto,

  PlayLifecycleState,

  PlayStatusDto,

  SafeAccountDto,

  SettingsDto,

  SettingsUpdateDto,

  SafeDiagnosticsDto,

  DiagnosticsCopyResultDto,

  UiError,

  ServerStatusDto,

  SystemInfoDto,

  FixedDiskInventoryDto,

  StorageSummaryDto,

  StorageOpenResultDto,

  UninstallMode,

} from '@sweetcraft/ipc';

import {

  DESKTOP_PRODUCT_NAME,

  DESKTOP_PRODUCT_VERSION,

} from '@sweetcraft/product';

import {

  LAUNCHER_BUILD_COMMIT,

  LAUNCHER_BUILD_ID,

} from '@sweetcraft/ipc/build.generated';



const DEFAULT_STATUS: LauncherStatusDto = {

  readiness: 'READY',

  packVersion: '0.1.2',

  installedVersion: '0.1.2',

  latestVersion: '0.1.2',

  minecraftVersion: '1.21.1',

  fabricVersion: '0.16.9',

  channel: 'dev',

  serverAddress: 'sweetcraft.datho.st',

  activeOperation: 'IDLE',

};



/** Matches Main 0.6E defaults (renderer-only in-memory copy for standalone/dev gateway). */
const DEFAULT_SETTINGS: SettingsDto = {
  language: 'fr',
  reducedMotion: false,
  memoryMiB: 2048,
};

function createDevSupportId(): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}



export type DevAuthFixture =

  | 'SIGNED_OUT'

  | 'RESTORING'

  | 'AUTHENTICATED'

  | 'REAUTH_REQUIRED'

  | 'APPID_BLOCKED'

  | 'NOT_OWNED'

  | 'ERROR';



export type DevInstallFixture =

  | 'NOT_INSTALLED'

  | 'READY'

  | 'UPDATE_AVAILABLE'

  | 'REPAIR_REQUIRED'

  | 'RECOVERY_REQUIRED'

  | 'BUSY'

  | 'NETWORK_ERROR'

  | 'INTEGRITY_ERROR'

  | 'GENERIC_ERROR';



export type DevPlayFixture =

  | 'SUCCESS'

  | 'GAME_ALREADY_RUNNING'

  | 'ACCOUNT_MISMATCH'

  | 'JAVA_UNAVAILABLE'

  | 'SPAWN_FAILURE'

  | 'BIND_FAILURE'

  | 'NONZERO_EXIT'

  | 'MALFORMED_LOCK'

  | 'GENERIC_ERROR';



const INSTALL_PHASES: InstallProgressPhase[] = [

  'PREPARING',

  'RESOLVING_RELEASE',

  'PLANNING',

  'DOWNLOADING',

  'APPLYING',

  'VERIFYING',

  'COMMITTING',

  'COMPLETED',

];



/**

 * Development-only gateway. Never selected in production builds.

 * Simulates auth and install without tokens or real filesystem.

 */

export class DevLauncherDesktopGateway implements LauncherDesktopGateway {

  readonly kind = 'dev' as const;



  private status: LauncherStatusDto = { ...DEFAULT_STATUS };

  private accountList: SafeAccountDto[] = [];

  private authState: AuthState = 'SIGNED_OUT';

  private selectedId: string | null = null;

  private authenticatedId: string | null = null;

  private authError: UiError | undefined;

  private opBusy = false;

  private installBusy = false;

  private loginCalls = 0;

  private authFixture: DevAuthFixture = 'SIGNED_OUT';

  private installFixture: DevInstallFixture = 'NOT_INSTALLED';

  /** Backend-derived instance directory flag for open-folder UX. */
  private instanceDirectoryExists = false;

  /** PACK-10.1G — dev mock configured instance path. */
  private devInstancePath = 'C:\\Dev\\SweetCraft';

  private playFixture: DevPlayFixture = 'SUCCESS';

  private playState: PlayLifecycleState = 'UNAVAILABLE';

  private playBusy = false;

  private playAccountId: string | null = null;

  private playUsername: string | null = null;

  private playLastExitCode: number | null = null;

  /** In-memory settings for Angular standalone/dev gateway only — not Electron Main. */
  private devSettings: SettingsDto = { ...DEFAULT_SETTINGS };

  /** Ephemeral correlation id for this gateway instance — not account/machine fingerprint. */
  private readonly supportId: string = createDevSupportId();

  private stateListeners = new Set<(s: AuthStateDto) => void>();

  private progressListeners = new Set<(p: AuthProgressDto) => void>();

  private installProgressListeners = new Set<(p: InstallProgressDto) => void>();

  private statusListeners = new Set<(s: LauncherStatusDto) => void>();

  private playStatusListeners = new Set<(s: PlayStatusDto) => void>();



  private emitState(): void {

    const s = this.buildState();

    for (const l of this.stateListeners) l(s);

  }



  private emitProgress(phase: AuthProgressDto['phase'], messageKey?: string): void {

    const p: AuthProgressDto = messageKey ? { phase, messageKey } : { phase };

    for (const l of this.progressListeners) l(p);

  }



  private emitInstallProgress(progress: InstallProgressDto): void {

    for (const l of this.installProgressListeners) l(progress);

  }



  private emitStatus(status: LauncherStatusDto): void {

    for (const l of this.statusListeners) l(status);

  }



  private emitPlayStatus(status: PlayStatusDto): void {

    for (const l of this.playStatusListeners) l(status);

  }



  private buildPlayStatus(): PlayStatusDto {
    const raw: {
      state: PlayLifecycleState;
      minecraftUsername?: string;
      accountId?: string;
      phaseKey?: string;
      messageKey?: string;
      lastExitCode?: number | null;
      error?: { code: string; messageKey: string };
    } = { state: this.playState };

    if (this.playUsername) raw.minecraftUsername = this.playUsername;
    if (this.playAccountId) raw.accountId = this.playAccountId;
    if (this.playState === 'LAUNCHING') raw.phaseKey = 'play.phase.launching';
    if (this.playState === 'RUNNING') {
      raw.phaseKey = 'play.phase.running';
      raw.messageKey = 'play.message.running';
    }
    if (this.playState === 'READY') raw.messageKey = 'play.message.ready';
    if (this.playState === 'EXITED') {
      raw.messageKey = 'play.message.exited';
      raw.lastExitCode = this.playLastExitCode ?? 0;
    }
    if (this.playState === 'UNAVAILABLE') raw.messageKey = 'play.message.unavailable';
    if (this.playState === 'RECOVERY_REQUIRED') raw.messageKey = 'error.play.malformed_lock';
    if (this.playLastExitCode !== null && this.playState === 'ERROR') {
      raw.lastExitCode = this.playLastExitCode;
      raw.messageKey = 'error.play.nonzero_exit';
      raw.error = { code: 'NONZERO_EXIT', messageKey: 'error.play.nonzero_exit' };
    }
    return raw;
  }



  private publishPlayStatus(partial?: {

    state?: PlayLifecycleState;

    accountId?: string | null;

    username?: string | null;

    lastExitCode?: number | null;

  }): void {

    if (partial?.state !== undefined) this.playState = partial.state;

    if (partial?.accountId !== undefined) this.playAccountId = partial.accountId;

    if (partial?.username !== undefined) this.playUsername = partial.username;

    if (partial?.lastExitCode !== undefined) this.playLastExitCode = partial.lastExitCode;

    this.emitPlayStatus(this.buildPlayStatus());

  }



  private resolvePlayEligibility(): { eligible: boolean; messageKey?: string; code?: string } {

    if (this.installBusy || this.status.readiness === 'BUSY') {

      return { eligible: false, code: 'INSTANCE_BUSY', messageKey: 'error.install.busy' };

    }

    const readiness = this.status.readiness;

    if (readiness === 'NOT_INSTALLED') {

      return { eligible: false, code: 'PLAY_INSTALL_REQUIRED', messageKey: 'error.play_install_required' };

    }

    if (readiness === 'UPDATE_AVAILABLE') {

      return { eligible: false, code: 'PLAY_UPDATE_REQUIRED', messageKey: 'error.play_update_required' };

    }

    if (readiness === 'REPAIR_REQUIRED') {

      return { eligible: false, code: 'PLAY_REPAIR_REQUIRED', messageKey: 'error.play_repair_required' };

    }

    if (readiness === 'RECOVERY_REQUIRED' || readiness === 'INCOMPATIBLE_STATE') {

      return { eligible: false, code: 'RECOVERY_REQUIRED', messageKey: 'error.install.recovery' };

    }

    if (readiness !== 'READY') {

      return { eligible: false, code: 'PLAY_UNAVAILABLE', messageKey: 'play.message.unavailable' };

    }

    if (this.authState !== 'AUTHENTICATED' || !this.authenticatedId) {

      return { eligible: false, code: 'AUTH_LOGIN_REQUIRED', messageKey: 'error.auth_login_required' };

    }

    return { eligible: true };

  }



  private buildState(): AuthStateDto {

    const dto: {

      state: AuthState;

      selectedAccountId?: string;

      account?: SafeAccountDto;

      error?: UiError;

    } = { state: this.authState };



    if (this.authState === 'AUTHENTICATED' && this.authenticatedId) {

      dto.selectedAccountId = this.authenticatedId;

      const acc = this.accountList.find((a) => a.accountId === this.authenticatedId);

      if (acc) dto.account = acc;

    } else {

      if (this.selectedId) dto.selectedAccountId = this.selectedId;

      const acc = this.accountList.find((a) => a.accountId === this.selectedId);

      if (acc) dto.account = acc;

    }

    if (this.authError) dto.error = this.authError;

    return dto;

  }



  private actionResult(): AuthActionResultDto {

    return { state: this.buildState(), accounts: this.accountList.map((a) => ({ ...a })) };

  }



  private publishStatus(partial?: Partial<LauncherStatusDto>): void {

    this.status = { ...this.status, ...partial };

    this.emitStatus({ ...this.status });

  }



  private fixtureToStatus(fixture: DevInstallFixture): Partial<LauncherStatusDto> {

    switch (fixture) {

      case 'NOT_INSTALLED':

        return {

          readiness: 'NOT_INSTALLED',

          installedVersion: undefined,

          latestVersion: '1.0.0-fake',

          packVersion: undefined,

        };

      case 'READY':

        return {

          readiness: 'READY',

          installedVersion: '1.0.0-fake',

          latestVersion: '1.0.0-fake',

          packVersion: '1.0.0-fake',

        };

      case 'UPDATE_AVAILABLE':

        return {

          readiness: 'UPDATE_AVAILABLE',

          installedVersion: '1.0.0-fake',

          latestVersion: '1.1.0-fake',

          packVersion: '1.0.0-fake',

        };

      case 'REPAIR_REQUIRED':

        return {

          readiness: 'REPAIR_REQUIRED',

          installedVersion: '1.0.0-fake',

          latestVersion: '1.0.0-fake',

          packVersion: '1.0.0-fake',

        };

      case 'RECOVERY_REQUIRED':

        return {

          readiness: 'RECOVERY_REQUIRED',

          installedVersion: '1.0.0-fake',

          latestVersion: '1.0.0-fake',

          packVersion: '1.0.0-fake',

          messageKey: 'install.message.recovery_required',

        };

      case 'BUSY':

        return {

          readiness: 'BUSY',

          installedVersion: '1.0.0-fake',

          latestVersion: '1.0.0-fake',

          packVersion: '1.0.0-fake',

          activeOperation: 'INSTALLING',

        };

      case 'NETWORK_ERROR':

        return {

          readiness: 'NOT_INSTALLED',

          installedVersion: undefined,

          latestVersion: '1.0.0-fake',

        };

      case 'INTEGRITY_ERROR':

        return {

          readiness: 'UPDATE_AVAILABLE',

          installedVersion: '1.0.0-fake',

          latestVersion: '1.1.0-fake',

          packVersion: '1.0.0-fake',

        };

      case 'GENERIC_ERROR':

        return {

          readiness: 'NOT_INSTALLED',

          installedVersion: undefined,

          latestVersion: '1.0.0-fake',

        };

    }

  }



  private async emitInstallPhases(

    operation: 'install' | 'update' | 'repair' | 'uninstall',

    active: InstallActiveOperation,

  ): Promise<void> {

    const totalFiles = 4;

    let completed = 0;

    for (const phase of INSTALL_PHASES) {

      if (phase === 'DOWNLOADING' || phase === 'APPLYING' || phase === 'VERIFYING') {

        completed = Math.min(totalFiles, completed + 1);

      }

      if (phase === 'COMPLETED') completed = totalFiles;

      const indeterminate = phase !== 'COMPLETED' && phase !== 'DOWNLOADING';

      const percent =

        phase === 'COMPLETED' ? 100 : indeterminate ? undefined : Math.round((completed / totalFiles) * 100);

      const progress: InstallProgressDto = {

        phase,

        operation,

        completedFiles: completed,

        totalFiles,

        currentItemLabel: phase === 'DOWNLOADING' ? 'pack-core' : undefined,

        percent,

        indeterminate: indeterminate || percent === undefined,

      };

      this.emitInstallProgress(progress);

      this.publishStatus({

        readiness: 'BUSY',

        activeOperation: active,

        progress,

      });

      await delay(20);

    }

  }



  private assertInstallMutable(): void {

    if (this.status.readiness === 'RECOVERY_REQUIRED') {

      throw { code: 'RECOVERY_REQUIRED', messageKey: 'error.install.recovery' };

    }

    if (this.installBusy || this.status.readiness === 'BUSY') {

      throw { code: 'INSTANCE_BUSY', messageKey: 'error.install.busy' };

    }

  }



  readonly app = {

    getInfo: async (): Promise<AppInfoDto> => ({

      name: DESKTOP_PRODUCT_NAME,

      version: DESKTOP_PRODUCT_VERSION,

      platform: 'win32',

      environment: 'development',

      buildCommit: LAUNCHER_BUILD_COMMIT,

      buildId: LAUNCHER_BUILD_ID,

      features: {

        fakeAuthHarness: true,

        fakeInstallHarness: true,

        fakePlayHarness: true,

      },

    }),

    minimize: (): void => {

      console.info('[dev-gateway] app.minimize()');

    },

    maximize: (): void => {

      console.info('[dev-gateway] app.maximize()');

    },

    close: (): void => {

      console.info('[dev-gateway] app.close()');

    },

  };



  readonly launcher = {

    getStatus: async (): Promise<LauncherStatusDto> => ({ ...this.status }),

  };



  readonly install = {

    getStatus: async (): Promise<LauncherStatusDto> => {

      this.publishStatus({ activeOperation: 'CHECKING' });

      await delay(10);

      const next = { ...this.status, activeOperation: 'IDLE' as InstallActiveOperation };

      this.status = next;

      this.emitStatus(next);

      return { ...next };

    },

    install: async (): Promise<LauncherStatusDto> => this.runInstallMutation('install', 'INSTALLING'),

    update: async (): Promise<LauncherStatusDto> => this.runInstallMutation('update', 'UPDATING'),

    repair: async (): Promise<LauncherStatusDto> => this.runInstallMutation('repair', 'REPAIRING'),

    uninstall: async (mode: UninstallMode): Promise<LauncherStatusDto> =>
      this.runInstallMutation('uninstall', 'UNINSTALLING', mode),

  };



  readonly play = {

    getStatus: async (): Promise<PlayStatusDto> => this.computePlayStatus(),

    start: async (): Promise<PlayStatusDto> => this.runPlayStart(),

  };



  private async computePlayStatus(): Promise<PlayStatusDto> {

    if (

      this.playState === 'LAUNCHING' ||

      this.playState === 'RUNNING' ||

      this.playState === 'RECOVERY_REQUIRED' ||

      (this.playState === 'ERROR' && this.playLastExitCode !== null)

    ) {

      return this.buildPlayStatus();

    }

    const elig = this.resolvePlayEligibility();

    if (elig.eligible) {

      const acc = this.accountList.find((a) => a.accountId === this.authenticatedId);

      this.publishPlayStatus({

        state: 'READY',

        accountId: this.authenticatedId,

        username: acc?.minecraftUsername ?? 'JoueurDemo',

        lastExitCode: null,

      });

      return this.buildPlayStatus();

    }

    this.publishPlayStatus({

      state: 'UNAVAILABLE',

      accountId: null,

      username: null,

      lastExitCode: null,

    });

    return this.buildPlayStatus();

  }



  private async runPlayStart(): Promise<PlayStatusDto> {

    if (this.playBusy || this.playState === 'LAUNCHING' || this.playState === 'RUNNING') {

      throw { code: 'GAME_ALREADY_RUNNING', messageKey: 'error.play.already_running' };

    }

    const elig = this.resolvePlayEligibility();

    if (!elig.eligible) {

      throw { code: elig.code ?? 'PLAY_UNAVAILABLE', messageKey: elig.messageKey ?? 'play.message.unavailable' };

    }

    if (this.playFixture === 'MALFORMED_LOCK') {

      this.publishPlayStatus({ state: 'RECOVERY_REQUIRED' });

      throw { code: 'MALFORMED_LOCK', messageKey: 'error.play.malformed_lock' };

    }

    if (this.playFixture === 'GAME_ALREADY_RUNNING') {

      throw { code: 'GAME_ALREADY_RUNNING', messageKey: 'error.play.already_running' };

    }

    if (this.playFixture === 'ACCOUNT_MISMATCH') {

      throw { code: 'AUTH_ACCOUNT_MISMATCH', messageKey: 'error.play.account_mismatch' };

    }

    if (this.playFixture === 'JAVA_UNAVAILABLE') {

      throw { code: 'JAVA_UNAVAILABLE', messageKey: 'error.play.java_unavailable' };

    }

    if (this.playFixture === 'GENERIC_ERROR') {

      throw { code: 'INTERNAL_ERROR', messageKey: 'error.play.generic' };

    }

    const accountId = this.authenticatedId!;

    const acc = this.accountList.find((a) => a.accountId === accountId);

    this.playBusy = true;

    try {

      this.publishPlayStatus({

        state: 'LAUNCHING',

        accountId,

        username: acc?.minecraftUsername ?? 'JoueurDemo',

        lastExitCode: null,

      });

      await delay(40);

      if (this.playFixture === 'SPAWN_FAILURE') {

        this.publishPlayStatus({ state: 'UNAVAILABLE', accountId: null, username: null });

        throw { code: 'SPAWN_FAILURE', messageKey: 'error.play.spawn_failure' };

      }

      if (this.playFixture === 'BIND_FAILURE') {

        this.publishPlayStatus({ state: 'UNAVAILABLE', accountId: null, username: null });

        throw { code: 'BIND_FAILURE', messageKey: 'error.play.bind_failure' };

      }

      this.publishPlayStatus({ state: 'RUNNING' });

      if (this.playFixture === 'NONZERO_EXIT') {

        void (async () => {

          await delay(60);

          this.simulatePlayExitInternal(1);

        })();

      }

      return this.buildPlayStatus();

    } finally {

      this.playBusy = false;

    }

  }



  private simulatePlayExitInternal(exitCode = 0): PlayStatusDto {

    if (this.playState !== 'RUNNING' && this.playState !== 'LAUNCHING') {

      throw { code: 'INTERNAL_ERROR', messageKey: 'error.play.generic' };

    }

    this.playLastExitCode = exitCode;

    if (exitCode === 0) {

      this.publishPlayStatus({ state: 'EXITED', accountId: null, username: null });

    } else {

      this.playState = 'ERROR';

      this.emitPlayStatus(this.buildPlayStatus());

    }

    return this.buildPlayStatus();

  }



  private async runInstallMutation(

    operation: 'install' | 'update' | 'repair' | 'uninstall',

    active: InstallActiveOperation,

    uninstallMode: 'SAFE' | 'COMPLETE' = 'SAFE',

  ): Promise<LauncherStatusDto> {

    if (this.installBusy) {

      throw { code: 'INSTANCE_BUSY', messageKey: 'error.install.busy' };

    }

    this.assertInstallMutable();

    this.installBusy = true;

    this.publishStatus({ readiness: 'BUSY', activeOperation: active, progress: undefined });

    try {

      if (this.installFixture === 'GENERIC_ERROR') {

        throw { code: 'INTERNAL_ERROR', messageKey: 'error.install.generic' };

      }

      await this.emitInstallPhases(operation, active);

      if (this.installFixture === 'NETWORK_ERROR') {

        throw { code: 'NETWORK_ERROR', messageKey: 'error.install.network' };

      }

      if (this.installFixture === 'INTEGRITY_ERROR') {

        const nextReadiness = operation === 'repair' ? 'REPAIR_REQUIRED' : 'UPDATE_AVAILABLE';

        this.installFixture = nextReadiness === 'REPAIR_REQUIRED' ? 'REPAIR_REQUIRED' : 'INTEGRITY_ERROR';

        Object.assign(this.status, this.fixtureToStatus(this.installFixture));

        throw { code: 'INTEGRITY_ERROR', messageKey: 'error.install.integrity' };

      }

      if (operation === 'uninstall') {
        this.installFixture = 'NOT_INSTALLED';
        Object.assign(this.status, this.fixtureToStatus('NOT_INSTALLED'));
        this.status = {
          ...this.status,
          activeOperation: 'IDLE',
          progress: undefined,
          readiness: 'NOT_INSTALLED',
        };
        if (uninstallMode === 'COMPLETE') {
          this.instanceDirectoryExists = false;
        }
      } else {
        this.installFixture = 'READY';
        this.instanceDirectoryExists = true;
        Object.assign(this.status, this.fixtureToStatus('READY'));
        this.status = {
          ...this.status,
          activeOperation: 'IDLE',
          progress: undefined,
          readiness: 'READY',
        };
      }

      this.emitStatus({ ...this.status });

      return { ...this.status };

    } finally {

      this.installBusy = false;

    }

  }



  readonly accounts = {

    list: async (): Promise<SafeAccountDto[]> => this.accountList.map((a) => ({ ...a })),

    select: async (accountId: string): Promise<AuthActionResultDto> => {

      if (this.opBusy) {

        throw { code: 'AUTH_OPERATION_BUSY', messageKey: 'error.auth_operation_busy' };

      }

      this.opBusy = true;

      try {

        const found = this.accountList.find((a) => a.accountId === accountId);

        if (!found) {

          throw { code: 'AUTH_ACCOUNT_NOT_FOUND', messageKey: 'error.auth_account_required' };

        }

        const previouslyAuthenticated = this.authenticatedId;

        this.selectedId = accountId;

        if (

          this.authState === 'AUTHENTICATED' &&

          previouslyAuthenticated !== null &&

          previouslyAuthenticated === accountId

        ) {

          this.emitState();

          return this.actionResult();

        }

        this.authenticatedId = null;

        this.authState = 'SIGNED_OUT';

        this.authError = undefined;

        this.emitState();

        return this.actionResult();

      } finally {

        this.opBusy = false;

      }

    },

  };



  readonly auth = {

    getState: async (): Promise<AuthStateDto> => this.buildState(),

    restore: async (accountId?: string): Promise<AuthActionResultDto> => {

      if (this.opBusy) {

        throw { code: 'AUTH_OPERATION_BUSY', messageKey: 'error.auth_operation_busy' };

      }

      this.opBusy = true;

      try {

        if (this.accountList.length === 0) {

          this.authState = 'SIGNED_OUT';

          this.authenticatedId = null;

          this.authError = undefined;

          this.emitState();

          return this.actionResult();

        }

        this.authenticatedId = null;

        this.authState = 'RESTORING';

        this.emitProgress('RESTORING', 'auth.progress.restoring');

        this.emitState();

        await delay(40);

        this.applyAuthFixtureResult(accountId);

        this.emitState();

        return this.actionResult();

      } finally {

        this.opBusy = false;

      }

    },

    login: async (): Promise<AuthActionResultDto> => {

      if (this.opBusy) {

        throw { code: 'AUTH_OPERATION_BUSY', messageKey: 'error.auth_operation_busy' };

      }

      this.opBusy = true;

      this.loginCalls += 1;

      try {

        this.authState = 'RESTORING';

        this.authenticatedId = null;

        this.authError = undefined;

        this.emitProgress('STARTING', 'auth.progress.starting');

        this.emitProgress('OPENING_BROWSER', 'auth.progress.opening_browser');

        this.emitState();

        await delay(60);

        if (this.authFixture === 'APPID_BLOCKED') {

          this.authState = 'ERROR';

          this.authError = {

            code: 'MINECRAFT_APP_NOT_AUTHORIZED',

            messageKey: 'error.minecraft_app_not_authorized',

          };

          this.emitProgress('FAILED');

        } else if (this.authFixture === 'NOT_OWNED') {

          this.authState = 'ERROR';

          this.authError = {

            code: 'MINECRAFT_NOT_OWNED',

            messageKey: 'error.minecraft_not_owned',

          };

          this.emitProgress('FAILED');

        } else if (this.authFixture === 'ERROR') {

          this.authState = 'ERROR';

          this.authError = { code: 'AUTH_HTTP_TIMEOUT', messageKey: 'error.network' };

          this.emitProgress('FAILED');

        } else {

          const account: SafeAccountDto = {

            accountId: 'mc:11111111-1111-1111-1111-111111111111',

            minecraftUsername: 'JoueurDemo',

            minecraftUuid: '11111111-1111-1111-1111-111111111111',

            lastUsedAtMs: Date.now(),

          };

          this.accountList = [account, ...this.accountList.filter((a) => a.accountId !== account.accountId)];

          this.selectedId = account.accountId;

          this.authenticatedId = account.accountId;

          this.authState = 'AUTHENTICATED';

          this.authError = undefined;

          this.emitProgress('AUTHENTICATED', 'auth.progress.authenticated');

        }

        this.emitState();

        return this.actionResult();

      } finally {

        this.opBusy = false;

      }

    },

    logout: async (accountId: string): Promise<AuthActionResultDto> => {

      if (this.opBusy) {

        throw { code: 'AUTH_OPERATION_BUSY', messageKey: 'error.auth_operation_busy' };

      }

      this.opBusy = true;

      try {

        const wasAuthenticated = this.authenticatedId === accountId;

        this.accountList = this.accountList.filter((a) => a.accountId !== accountId);

        if (wasAuthenticated) {

          this.authenticatedId = null;

          this.authState = 'SIGNED_OUT';

          this.authError = undefined;

          this.selectedId = this.accountList[0]?.accountId ?? null;

        } else if (this.selectedId === accountId) {

          this.selectedId = this.authenticatedId;

        }

        this.emitState();

        return this.actionResult();

      } finally {

        this.opBusy = false;

      }

    },

  };



  readonly dev = {

    setAuthFixture: async (fixture: string): Promise<void> => {

      this.setAuthFixture(fixture as DevAuthFixture);

    },

    setInstallFixture: async (fixture: string): Promise<void> => {

      this.setInstallFixture(fixture as DevInstallFixture);

    },

    setPlayFixture: async (fixture: string): Promise<void> => {

      this.setPlayFixture(fixture as DevPlayFixture);

    },

    simulatePlayExit: async (opts?: { exitCode?: number }): Promise<PlayStatusDto> => {

      return this.simulatePlayExitInternal(opts?.exitCode ?? 0);

    },

  };



  private buildDevDiagnostics(): SafeDiagnosticsDto {
    const auth = this.buildState();
    const username =
      auth.account?.minecraftUsername?.trim().slice(0, 64) ||
      this.playUsername?.trim().slice(0, 64) ||
      null;
    const playState = this.playState;
    return {
      productName: DESKTOP_PRODUCT_NAME,
      launcherVersion: DESKTOP_PRODUCT_VERSION,
      buildId: LAUNCHER_BUILD_ID,
      buildCommit: LAUNCHER_BUILD_COMMIT,
      environment: 'development',
      platform: 'win32',
      architecture: 'x64',
      installReadiness: this.status.readiness,
      installedPackVersion: this.status.installedVersion ?? this.status.packVersion ?? null,
      availablePackVersion: this.status.latestVersion ?? null,
      minecraftVersion: this.status.minecraftVersion ?? null,
      fabricVersion: this.status.fabricVersion ?? null,
      channel: this.status.channel ?? null,
      authState: this.authState,
      minecraftUsername: username,
      playState,
      gameRunning: playState === 'RUNNING' || playState === 'LAUNCHING',
      activeInstallOperation: this.status.activeOperation ?? null,
      memoryMiB:
        typeof this.devSettings.memoryMiB === 'number' ? this.devSettings.memoryMiB : null,
      lastAuthErrorCode: this.authError?.code ?? null,
      lastInstallErrorCode:
        this.status.readiness === 'ERROR' ? (this.status.messageKey ?? null) : null,
      lastPlayErrorCode: null,
      appIdBlocked: this.authError?.code === 'MINECRAFT_APP_NOT_AUTHORIZED',
      fakeAuthHarness: true,
      fakeInstallHarness: true,
      fakePlayHarness: true,
      supportId: this.supportId,
      instanceLocationConfigured: this.devSettings.instanceLocationConfigured === true,
    };
  }

  readonly settings = {
    get: async (): Promise<SettingsDto> => ({ ...this.devSettings }),

    update: async (patch: SettingsUpdateDto): Promise<SettingsDto> => {
      if (patch.memoryMiB === undefined && patch.reducedMotion === undefined) {
        const err: UiError = { code: 'SETTINGS_INVALID', messageKey: 'error.settings.invalid' };
        return Promise.reject(err);
      }
      if (patch.memoryMiB !== undefined) {
        if (
          typeof patch.memoryMiB !== 'number' ||
          !Number.isInteger(patch.memoryMiB) ||
          patch.memoryMiB < 512 ||
          patch.memoryMiB > 32768
        ) {
          const err: UiError = { code: 'SETTINGS_INVALID', messageKey: 'error.settings.invalid' };
          return Promise.reject(err);
        }
        this.devSettings = { ...this.devSettings, memoryMiB: patch.memoryMiB };
      }
      if (patch.reducedMotion !== undefined) {
        this.devSettings = { ...this.devSettings, reducedMotion: patch.reducedMotion };
      }
      return { ...this.devSettings };
    },
  };

  readonly diagnostics = {
    get: async (): Promise<SafeDiagnosticsDto> => this.buildDevDiagnostics(),

    copy: async (): Promise<DiagnosticsCopyResultDto> => {
      const dto = this.buildDevDiagnostics();
      const text = [
        `${dto.productName} ${dto.launcherVersion}`,
        `Build ID: ${dto.buildId ?? 'unavailable'}`,
        `Build commit: ${dto.buildCommit ?? 'unavailable'}`,
        `OS: ${dto.platform} ${dto.architecture}`,
        `Environment: ${dto.environment}`,
        `Install: ${dto.installReadiness}`,
        `Auth: ${dto.authState}`,
        `Play: ${dto.playState}`,
        `Memory: ${dto.memoryMiB != null ? `${dto.memoryMiB} MiB` : 'unknown'}`,
        `Support ID: ${dto.supportId}`,
      ].join('\n');
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(`${text}\n`);
      }
      return { copied: true, textLength: text.length + 1 };
    },
  };

  /**
   * Browser/dev gateway — no live Minecraft TCP.
   * Returns UNKNOWN so UI never invents online/players/ping.
   */
  readonly server = {
    getStatus: async (): Promise<ServerStatusDto> => ({
      state: 'UNKNOWN',
      latencyMs: null,
      playersOnline: null,
      playersMax: null,
      versionLabel: null,
      checkedAt: new Date().toISOString(),
      address: 'sweetcraft.datho.st',
    }),
  };

  /**
   * Browser/dev — synthetic safe snapshot (no real os/fs paths).
   */
  readonly system = {
    getInfo: async (): Promise<SystemInfoDto> => ({
      available: true,
      platform: 'win32',
      arch: 'x64',
      osLabel: 'Windows 10+',
      cpuModel: 'Dev CPU',
      cpuCount: 8,
      totalMemoryMiB: 16384,
      freeMemoryMiB: 8192,
      diskTotalGiB: null,
      diskFreeGiB: null,
      launcherVersion: DESKTOP_PRODUCT_VERSION,
      checkedAtMs: Date.now(),
      recommendedMemoryMiB: 4096,
    }),
    getFixedDisks: async (): Promise<FixedDiskInventoryDto> => ({
      available: true,
      checkedAtMs: Date.now(),
      disks: [
        {
          drive: 'C:',
          totalGiB: 512,
          freeGiB: 128,
          usedPercent: 75,
          isSweetCraftDrive: true,
        },
        {
          drive: 'D:',
          totalGiB: 1024,
          freeGiB: 400,
          usedPercent: 61,
          isSweetCraftDrive: false,
        },
      ],
    }),
  };

  readonly storage = {
    getSummary: async (): Promise<StorageSummaryDto> => ({
      instanceAvailable: this.instanceDirectoryExists,
      logsAvailable: this.instanceDirectoryExists,
      launcherDataAvailable: true,
      instanceLocationConfigured: true,
      instanceLocationAvailable: true,
      instancePath: this.devInstancePath,
    }),
    openInstance: async (): Promise<StorageOpenResultDto> => ({
      opened: false,
      target: 'instance',
      unavailable: true,
    }),
    openLogs: async (): Promise<StorageOpenResultDto> => ({
      opened: false,
      target: 'logs',
      unavailable: true,
    }),
  };

  readonly instance = {
    chooseLocation: async () => ({
      cancelled: false,
      path: 'D:\\Games\\SweetCraft',
    }),
    setLocation: async (path: string) => {
      this.devInstancePath = path;
      return {
        sweetcraftInstancePath: path,
        instanceLocationConfigured: true,
        instanceLocationAvailable: true,
      };
    },
    move: async (destinationPath: string) => {
      this.devInstancePath = destinationPath;
      this.instanceDirectoryExists = true;
      return {
        sweetcraftInstancePath: destinationPath,
        instanceLocationConfigured: true,
        instanceLocationAvailable: true,
      };
    },
  };

  readonly events = {

    onAuthStateChanged: (listener: (payload: AuthStateDto) => void): (() => void) => {

      this.stateListeners.add(listener);

      return () => this.stateListeners.delete(listener);

    },

    onAuthProgress: (listener: (payload: AuthProgressDto) => void): (() => void) => {

      this.progressListeners.add(listener);

      return () => this.progressListeners.delete(listener);

    },

    onInstallProgress: (listener: (payload: InstallProgressDto) => void): (() => void) => {

      this.installProgressListeners.add(listener);

      return () => this.installProgressListeners.delete(listener);

    },

    onLauncherStatusChanged: (listener: (payload: LauncherStatusDto) => void): (() => void) => {

      this.statusListeners.add(listener);

      return () => this.statusListeners.delete(listener);

    },

    onPlayStatusChanged: (listener: (payload: PlayStatusDto) => void): (() => void) => {

      this.playStatusListeners.add(listener);

      return () => this.playStatusListeners.delete(listener);

    },

  };



  setDemoReadiness(readiness: LauncherReadiness, partial?: Partial<LauncherStatusDto>): void {

    this.status = { ...this.status, readiness, activeOperation: 'IDLE', progress: undefined, ...partial };

    this.emitStatus({ ...this.status });

  }



  setDemoAuthState(state: AuthState): void {

    this.authState = state;

    if (state === 'AUTHENTICATED' && this.accountList.length === 0) {

      this.accountList = [

        {

          accountId: 'mc:demo',

          minecraftUsername: 'JoueurDemo',

          lastUsedAtMs: Date.now(),

        },

      ];

      this.selectedId = 'mc:demo';

      this.authenticatedId = 'mc:demo';

    } else if (state === 'AUTHENTICATED' && this.selectedId) {

      this.authenticatedId = this.selectedId;

    } else if (state !== 'AUTHENTICATED') {

      this.authenticatedId = null;

    }

    this.emitState();

  }



  setAuthFixture(fixture: DevAuthFixture): void {

    this.authFixture = fixture;

    switch (fixture) {

      case 'SIGNED_OUT':

        this.accountList = [];

        this.selectedId = null;

        this.authenticatedId = null;

        this.authState = 'SIGNED_OUT';

        this.authError = undefined;

        break;

      case 'AUTHENTICATED':

        this.accountList = [

          {

            accountId: 'mc:11111111-1111-1111-1111-111111111111',

            minecraftUsername: 'JoueurDemo',

            lastUsedAtMs: 1,

          },

        ];

        this.selectedId = this.accountList[0]!.accountId;

        this.authenticatedId = this.selectedId;

        this.authState = 'AUTHENTICATED';

        this.authError = undefined;

        break;

      case 'REAUTH_REQUIRED':

        this.accountList = [

          {

            accountId: 'mc:11111111-1111-1111-1111-111111111111',

            minecraftUsername: 'JoueurDemo',

            lastUsedAtMs: 1,

          },

        ];

        this.selectedId = this.accountList[0]!.accountId;

        this.authenticatedId = null;

        this.authState = 'REAUTH_REQUIRED';

        this.authError = {

          code: 'AUTH_REAUTH_REQUIRED',

          messageKey: 'error.auth_reauth_required',

        };

        break;

      case 'APPID_BLOCKED':

        this.authenticatedId = null;

        this.authState = 'ERROR';

        this.authError = {

          code: 'MINECRAFT_APP_NOT_AUTHORIZED',

          messageKey: 'error.minecraft_app_not_authorized',

        };

        break;

      case 'NOT_OWNED':

        this.authenticatedId = null;

        this.authState = 'ERROR';

        this.authError = {

          code: 'MINECRAFT_NOT_OWNED',

          messageKey: 'error.minecraft_not_owned',

        };

        break;

      case 'RESTORING':

        this.authenticatedId = null;

        this.authState = 'RESTORING';

        break;

      case 'ERROR':

        this.authenticatedId = null;

        this.authState = 'ERROR';

        this.authError = { code: 'AUTH_HTTP_TIMEOUT', messageKey: 'error.network' };

        break;

    }

    this.emitState();

  }



  setInstallFixture(fixture: DevInstallFixture): void {

    this.installFixture = fixture;

    this.instanceDirectoryExists = fixture !== 'NOT_INSTALLED';

    Object.assign(this.status, this.fixtureToStatus(fixture));

    this.status = {

      ...this.status,

      activeOperation: fixture === 'BUSY' ? 'INSTALLING' : 'IDLE',

      progress: undefined,

    };

    this.emitStatus({ ...this.status });

  }



  setPlayFixture(fixture: DevPlayFixture): void {

    this.playFixture = fixture;

    this.playBusy = false;

    this.playLastExitCode = null;

    if (fixture === 'GAME_ALREADY_RUNNING') {

      this.playState = 'RUNNING';

      this.playAccountId = 'mc:fake-demo';

      this.playUsername = 'JoueurDemo';

    } else if (fixture === 'MALFORMED_LOCK') {

      this.playState = 'RECOVERY_REQUIRED';

      this.playAccountId = null;

      this.playUsername = null;

    } else {

      this.playState = 'UNAVAILABLE';

      this.playAccountId = null;

      this.playUsername = null;

    }

    this.emitPlayStatus(this.buildPlayStatus());

  }



  getLoginCallCount(): number {

    return this.loginCalls;

  }



  private applyAuthFixtureResult(accountId?: string): void {

    if (this.authFixture === 'REAUTH_REQUIRED') {

      this.authState = 'REAUTH_REQUIRED';

      this.authenticatedId = null;

      this.authError = {

        code: 'AUTH_REAUTH_REQUIRED',

        messageKey: 'error.auth_reauth_required',

      };

      return;

    }

    if (this.authFixture === 'APPID_BLOCKED') {

      this.authState = 'ERROR';

      this.authenticatedId = null;

      this.authError = {

        code: 'MINECRAFT_APP_NOT_AUTHORIZED',

        messageKey: 'error.minecraft_app_not_authorized',

      };

      return;

    }

    if (this.authFixture === 'ERROR') {

      this.authState = 'ERROR';

      this.authenticatedId = null;

      this.authError = { code: 'AUTH_HTTP_TIMEOUT', messageKey: 'error.network' };

      return;

    }

    const id = accountId ?? this.accountList[0]?.accountId;

    if (!id) {

      this.authState = 'SIGNED_OUT';

      this.authenticatedId = null;

      return;

    }

    this.selectedId = id;

    this.authenticatedId = id;

    this.authState = 'AUTHENTICATED';

    this.authError = undefined;

  }

}



function delay(ms: number): Promise<void> {

  return new Promise((r) => setTimeout(r, ms));

}


