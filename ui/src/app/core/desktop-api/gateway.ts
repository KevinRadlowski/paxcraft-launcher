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

  InstanceChooseLocationResultDto,

  InstanceLocationResultDto,

} from '@sweetcraft/ipc';

import { InjectionToken } from '@angular/core';



export interface LauncherDesktopGateway {

  readonly kind: 'electron' | 'dev';



  app: {

    getInfo(): Promise<AppInfoDto>;

    minimize(): void | Promise<void>;

    maximize(): void | Promise<void>;

    close(): void | Promise<void>;

  };



  launcher: {

    getStatus(): Promise<LauncherStatusDto>;

  };



  install: {

    getStatus(): Promise<LauncherStatusDto>;

    install(): Promise<LauncherStatusDto>;

    update(): Promise<LauncherStatusDto>;

    repair(): Promise<LauncherStatusDto>;

    uninstall(mode: import('@sweetcraft/ipc').UninstallMode): Promise<LauncherStatusDto>;

  };



  play: {

    getStatus(): Promise<PlayStatusDto>;

    start(): Promise<PlayStatusDto>;

  };



  accounts: {

    list(): Promise<SafeAccountDto[]>;

    select(accountId: string): Promise<AuthActionResultDto>;

  };



  auth: {

    getState(): Promise<AuthStateDto>;

    restore(accountId?: string): Promise<AuthActionResultDto>;

    login(): Promise<AuthActionResultDto>;

    logout(accountId: string): Promise<AuthActionResultDto>;

  };



  /** Electron fake harness only — optional. */

  dev?: {

    setAuthFixture?(fixture: string): Promise<void>;

    setInstallFixture?(fixture: string): Promise<void>;

    setPlayFixture?(fixture: string): Promise<void>;

    simulatePlayExit?(opts?: { exitCode?: number }): Promise<PlayStatusDto>;

  };



  settings: {

    get(): Promise<SettingsDto>;

    update(patch: SettingsUpdateDto): Promise<SettingsDto>;

  };



  diagnostics: {

    get(): Promise<SafeDiagnosticsDto>;

    copy(): Promise<DiagnosticsCopyResultDto>;

  };



  server: {

    getStatus(): Promise<ServerStatusDto>;

  };



  system: {

    getInfo(): Promise<SystemInfoDto>;

    getFixedDisks(): Promise<FixedDiskInventoryDto>;

  };



  storage: {

    getSummary(): Promise<StorageSummaryDto>;

    openInstance(): Promise<StorageOpenResultDto>;

    openLogs(): Promise<StorageOpenResultDto>;

  };

  instance: {

    chooseLocation(): Promise<InstanceChooseLocationResultDto>;

    setLocation(path: string): Promise<InstanceLocationResultDto>;

    move(destinationPath: string): Promise<InstanceLocationResultDto>;

  };



  events?: {
    onAuthStateChanged(listener: (payload: AuthStateDto) => void): () => void;

    onAuthProgress(listener: (payload: AuthProgressDto) => void): () => void;

    onInstallProgress(listener: (payload: InstallProgressDto) => void): () => void;

    onLauncherStatusChanged(listener: (payload: LauncherStatusDto) => void): () => void;

    onPlayStatusChanged(listener: (payload: PlayStatusDto) => void): () => void;

    onNotification?(

      listener: (payload: {

        level: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';

        messageKey: string;

      }) => void,

    ): () => void;

  };

}



export const LAUNCHER_DESKTOP_GATEWAY = new InjectionToken<LauncherDesktopGateway>(

  'LAUNCHER_DESKTOP_GATEWAY',

);



export function isDevGateway(

  gateway: LauncherDesktopGateway,

): gateway is DevLauncherDesktopGatewayMarker {

  return gateway.kind === 'dev';

}



export interface DevLauncherDesktopGatewayMarker extends LauncherDesktopGateway {

  readonly kind: 'dev';

}



export type { AccountSummaryDto };


