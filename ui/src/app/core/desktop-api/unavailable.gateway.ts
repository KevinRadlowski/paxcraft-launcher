import type { LauncherDesktopGateway } from './gateway';

import type {

  AppInfoDto,

  AuthActionResultDto,

  AuthStateDto,

  LauncherStatusDto,

  PlayStatusDto,

  SafeAccountDto,

  ServerStatusDto,

  SettingsDto,

  SystemInfoDto,

  FixedDiskInventoryDto,

  StorageSummaryDto,

  StorageOpenResultDto,

  UiError,

  UninstallMode,

} from '@sweetcraft/ipc';



/**

 * Production fail-closed gateway when preload bridge is missing.

 */

export class DesktopBridgeUnavailableGateway implements LauncherDesktopGateway {

  readonly kind = 'electron' as const;



  private fail(): Promise<never> {

    const err: UiError = {

      code: 'DESKTOP_BRIDGE_UNAVAILABLE',

      messageKey: 'error.desktop_bridge_unavailable',

    };

    return Promise.reject(err);

  }



  readonly app = {

    getInfo: (): Promise<AppInfoDto> => this.fail(),

    minimize: (): Promise<void> => this.fail(),

    maximize: (): Promise<void> => this.fail(),

    close: (): Promise<void> => this.fail(),

  };



  readonly launcher = {

    getStatus: (): Promise<LauncherStatusDto> => this.fail(),

  };



  readonly install = {

    getStatus: (): Promise<LauncherStatusDto> => this.fail(),

    install: (): Promise<LauncherStatusDto> => this.fail(),

    update: (): Promise<LauncherStatusDto> => this.fail(),

    repair: (): Promise<LauncherStatusDto> => this.fail(),

    uninstall: (_mode: UninstallMode): Promise<LauncherStatusDto> => this.fail(),

  };



  readonly play = {

    getStatus: (): Promise<PlayStatusDto> => this.fail(),

    start: (): Promise<PlayStatusDto> => this.fail(),

  };



  readonly accounts = {

    list: (): Promise<SafeAccountDto[]> => this.fail(),

    select: (): Promise<AuthActionResultDto> => this.fail(),

  };



  readonly auth = {

    getState: (): Promise<AuthStateDto> => this.fail(),

    restore: (): Promise<AuthActionResultDto> => this.fail(),

    login: (): Promise<AuthActionResultDto> => this.fail(),

    logout: (): Promise<AuthActionResultDto> => this.fail(),

  };



  readonly settings = {

    get: (): Promise<SettingsDto> => this.fail(),

    update: (): Promise<SettingsDto> => this.fail(),

  };

  readonly diagnostics = {

    get: (): Promise<never> => this.fail(),

    copy: (): Promise<never> => this.fail(),

  };

  readonly server = {

    getStatus: (): Promise<ServerStatusDto> => this.fail(),

  };



  readonly system = {

    getInfo: (): Promise<SystemInfoDto> => this.fail(),

    getFixedDisks: (): Promise<FixedDiskInventoryDto> => this.fail(),

  };



  readonly storage = {

    getSummary: (): Promise<StorageSummaryDto> => this.fail(),

    openInstance: (): Promise<StorageOpenResultDto> => this.fail(),

    openLogs: (): Promise<StorageOpenResultDto> => this.fail(),

  };

  readonly instance = {

    chooseLocation: () => this.fail(),

    setLocation: () => this.fail(),

    move: () => this.fail(),

  };

}


