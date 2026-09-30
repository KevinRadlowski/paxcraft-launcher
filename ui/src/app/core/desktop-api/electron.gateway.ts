import type { LauncherDesktopGateway } from './gateway';

import type {

  AppInfoDto,

  AccountSummaryDto,

  AuthActionResultDto,

  AuthProgressDto,

  AuthStateDto,

  InstallProgressDto,

  LauncherStatusDto,

  PlayStatusDto,

  SafeAccountDto,

  SettingsDto,

  SettingsUpdateDto,

  SafeDiagnosticsDto,

  DiagnosticsCopyResultDto,

  ServerStatusDto,

  SystemInfoDto,

  FixedDiskInventoryDto,

  StorageSummaryDto,

  StorageOpenResultDto,

  SweetCraftDesktopApi,

  UninstallMode,

} from '@sweetcraft/ipc';



declare global {

  interface Window {

    sweetcraft?: SweetCraftDesktopApi;

  }

}



export class ElectronLauncherDesktopGateway implements LauncherDesktopGateway {

  readonly kind = 'electron' as const;



  private get api(): SweetCraftDesktopApi {

    const api = window.sweetcraft;

    if (!api) {

      throw new Error('SweetCraft preload API unavailable');

    }

    return api;

  }



  readonly app = {

    getInfo: (): Promise<AppInfoDto> => this.api.app.getInfo(),

    minimize: (): Promise<void> => this.api.app.minimize(),

    maximize: (): Promise<void> => this.api.app.maximize(),

    close: (): Promise<void> => this.api.app.close(),

  };



  readonly launcher = {

    getStatus: (): Promise<LauncherStatusDto> => this.api.launcher.getStatus(),

  };



  readonly install = {

    getStatus: (): Promise<LauncherStatusDto> => this.api.install.getStatus(),

    install: (): Promise<LauncherStatusDto> => this.api.install.install(),

    update: (): Promise<LauncherStatusDto> => this.api.install.update(),

    repair: (): Promise<LauncherStatusDto> => this.api.install.repair(),

    uninstall: (mode: UninstallMode): Promise<LauncherStatusDto> =>
      this.api.install.uninstall(mode),

  };



  readonly play = {

    getStatus: (): Promise<PlayStatusDto> => this.api.play.getStatus(),

    start: (): Promise<PlayStatusDto> => this.api.play.start(),

  };



  readonly accounts = {

    list: (): Promise<SafeAccountDto[]> => this.api.accounts.list(),

    select: (accountId: string): Promise<AuthActionResultDto> =>

      this.api.accounts.select(accountId),

  };



  readonly auth = {

    getState: (): Promise<AuthStateDto> => this.api.auth.getState(),

    restore: (accountId?: string): Promise<AuthActionResultDto> =>

      this.api.auth.restore(accountId),

    login: (): Promise<AuthActionResultDto> => this.api.auth.login(),

    logout: (accountId: string): Promise<AuthActionResultDto> =>

      this.api.auth.logout(accountId),

  };



  readonly dev = {

    setAuthFixture: (fixture: string): Promise<void> => {

      if (!this.api.dev?.setAuthFixture) {

        return Promise.reject({

          code: 'IPC_INVALID_PAYLOAD',

          messageKey: 'errors.ipc.invalid_payload',

        });

      }

      return this.api.dev.setAuthFixture(fixture);

    },

    setInstallFixture: (fixture: string): Promise<void> => {

      if (!this.api.dev?.setInstallFixture) {

        return Promise.reject({

          code: 'IPC_INVALID_PAYLOAD',

          messageKey: 'errors.ipc.invalid_payload',

        });

      }

      return this.api.dev.setInstallFixture(fixture);

    },

    setPlayFixture: (fixture: string): Promise<void> => {

      if (!this.api.dev?.setPlayFixture) {

        return Promise.reject({

          code: 'IPC_INVALID_PAYLOAD',

          messageKey: 'errors.ipc.invalid_payload',

        });

      }

      return this.api.dev.setPlayFixture(fixture);

    },

    simulatePlayExit: (opts?: { exitCode?: number }): Promise<PlayStatusDto> => {

      if (!this.api.dev?.simulatePlayExit) {

        return Promise.reject({

          code: 'IPC_INVALID_PAYLOAD',

          messageKey: 'errors.ipc.invalid_payload',

        });

      }

      return this.api.dev.simulatePlayExit(opts);

    },

  };



  readonly settings = {

    get: (): Promise<SettingsDto> => this.api.settings.get(),

    update: (patch: SettingsUpdateDto): Promise<SettingsDto> => this.api.settings.update(patch),

  };



  readonly diagnostics = {

    get: (): Promise<SafeDiagnosticsDto> => this.api.diagnostics.get(),

    copy: (): Promise<DiagnosticsCopyResultDto> => this.api.diagnostics.copy(),

  };



  readonly server = {

    getStatus: (): Promise<ServerStatusDto> => this.api.server.getStatus(),

  };



  readonly system = {

    getInfo: (): Promise<SystemInfoDto> => this.api.system.getInfo(),

    getFixedDisks: (): Promise<FixedDiskInventoryDto> => this.api.system.getFixedDisks(),

  };



  readonly storage = {

    getSummary: (): Promise<StorageSummaryDto> => this.api.storage.getSummary(),

    openInstance: (): Promise<StorageOpenResultDto> => this.api.storage.openInstance(),

    openLogs: (): Promise<StorageOpenResultDto> => this.api.storage.openLogs(),

  };

  readonly instance = {

    chooseLocation: () => this.api.instance.chooseLocation(),

    setLocation: (path: string) => this.api.instance.setLocation(path),

    move: (destinationPath: string) => this.api.instance.move(destinationPath),

  };



  readonly events = {

    onAuthStateChanged: (listener: (payload: AuthStateDto) => void): (() => void) =>

      this.api.events.onAuthStateChanged(listener),

    onAuthProgress: (listener: (payload: AuthProgressDto) => void): (() => void) =>

      this.api.events.onAuthProgress(listener),

    onInstallProgress: (listener: (payload: InstallProgressDto) => void): (() => void) =>

      this.api.events.onInstallProgress(listener),

    onLauncherStatusChanged: (listener: (payload: LauncherStatusDto) => void): (() => void) =>

      this.api.events.onLauncherStatusChanged(listener),

    onPlayStatusChanged: (listener: (payload: PlayStatusDto) => void): (() => void) =>

      this.api.events.onPlayStatusChanged(listener),

    onNotification: (

      listener: (payload: {

        level: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';

        messageKey: string;

      }) => void,

    ): (() => void) => this.api.events.onNotification(listener),

  };

}



export type { AccountSummaryDto };


