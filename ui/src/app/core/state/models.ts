import type {
  AppInfoDto,
  AuthState,
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

export type { AuthState, LauncherReadiness } from '@sweetcraft/ipc';

export type OperationState = 'idle' | 'running' | 'success' | 'error';

export interface AppState {
  readonly initialized: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly info: AppInfoDto | null;
  readonly status: LauncherStatusDto | null;
  readonly accounts: readonly SafeAccountDto[];
  readonly settings: SettingsDto | null;
  readonly activeAccountId: string | null;
  readonly operation: OperationState;
  readonly authState: AuthState;
  readonly authError: UiError | null;
  readonly authProgressKey: string | null;
  /** Status probe failure (readiness ERROR) — distinct from mutation errors. */
  readonly statusError: UiError | null;
  /** Last install/update/repair IPC failure — cleared on new mutation. */
  readonly operationError: UiError | null;
  readonly activeOperation: InstallActiveOperation;
  /** Renderer-authoritative mutation start — whole-operation elapsed display. */
  readonly installOperationStartedAt: number | null;
  readonly installProgress: InstallProgressDto | null;
  readonly uninstallMode: UninstallMode | null;
  /** Play lifecycle — distinct from installation readiness. */
  readonly playStatus: PlayStatusDto | null;
  /** Last play start/status failure — cleared on new start. */
  readonly playError: UiError | null;
}

export interface PrimaryActionPresentation {
  readonly kind:
    | 'INSTALL'
    | 'UPDATE'
    | 'REPAIR'
    | 'PLAY'
    | 'SIGN_IN'
    | 'REAUTH'
    | 'IN_PROGRESS'
    | 'ACTION_REQUIRED'
    | 'VERIFY'
    | 'UNAVAILABLE';
  readonly labelKey: string;
  readonly enabled: boolean;
  readonly variant: 'primary' | 'secondary' | 'danger' | 'ghost';
  readonly readiness: LauncherReadiness;
  readonly authState: AuthState | null;
}

export interface DemoFixtureState {
  readonly readiness: LauncherReadiness;
  readonly authState: AuthState;
}
