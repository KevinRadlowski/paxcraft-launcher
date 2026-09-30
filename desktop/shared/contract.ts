/**
 * Shared IPC contract — Main, Preload, Renderer.
 * Renderer treats this as untrusted-input contract; Main validates at runtime.
 */

export type LauncherReadiness =
  | "NOT_INSTALLED"
  | "READY"
  | "UPDATE_AVAILABLE"
  | "REPAIR_REQUIRED"
  | "BUSY"
  | "INCOMPATIBLE_STATE"
  | "RECOVERY_REQUIRED"
  | "UNKNOWN"
  /** Desktop-only: status check in flight (not a 0.5A InstanceStatusCode). */
  | "CHECKING"
  /** Desktop-only: status probe failed safely (not a 0.5A InstanceStatusCode). */
  | "ERROR"
  /** Desktop-only: configured instance path volume is unavailable (PACK-10.1G). */
  | "LOCATION_UNAVAILABLE";

/**
 * 0.6C — cancellation is NOT exposed in UI.
 * 0.5A accepts optional AbortSignal at checkpoints only; mid-download/apply
 * abort is not a safe full-operation contract. Do not invent Cancel IPC.
 */
export const CANCELLATION_SUPPORTED = false as const;

/**
 * Canonical UI auth state (aligned with frozen auth semantics).
 * AUTHENTICATED = usable Minecraft session present.
 * REAUTH_REQUIRED = invalid_grant / credential deleted / explicit re-login needed.
 * RESTORING = in-flight restore/refresh/login (no tokens in UI state).
 */
export type AuthState =
  | "UNKNOWN"
  | "SIGNED_OUT"
  | "RESTORING"
  | "AUTHENTICATED"
  | "REAUTH_REQUIRED"
  | "ERROR";

/** Legacy coarse game flag — prefer PlayLifecycleState for 0.6D. */
export type GameState = "STOPPED" | "STARTING" | "RUNNING" | "EXITED";

/**
 * Canonical desktop play lifecycle (distinct from installation readiness).
 * UNAVAILABLE = not eligible (install/auth/lock) without claiming ERROR.
 */
export type PlayLifecycleState =
  | "UNAVAILABLE"
  | "READY"
  | "LAUNCHING"
  | "RUNNING"
  | "EXITED"
  | "ERROR"
  | "RECOVERY_REQUIRED";

/** Safe play status for renderer — no PID/command/token/path by default. */
export interface PlayStatusDto {
  readonly state: PlayLifecycleState;
  readonly messageKey?: string;
  readonly minecraftUsername?: string;
  readonly accountId?: string;
  /** Diagnostic numeric only — never stderr. */
  readonly lastExitCode?: number | null;
  readonly error?: UiError;
  /** Phase guidance key while LAUNCHING/RUNNING. */
  readonly phaseKey?: string;
}

export type OperationState = "IDLE" | "INSTALLING" | "UPDATING" | "REPAIRING" | "BUSY";

/** Active mutation tracked by desktop install service (Main-authoritative). */
export type InstallActiveOperation =
  | "IDLE"
  | "CHECKING"
  | "INSTALLING"
  | "UPDATING"
  | "REPAIRING"
  | "UNINSTALLING"
  | "MOVING_INSTANCE";

/**
 * Normalized install progress phases — mapped from 0.5A OperationPhase
 * (and fake harness equivalents). Percent only when denominators are reliable.
 */
export type InstallProgressPhase =
  | "PREPARING"
  | "RESOLVING_RELEASE"
  | "INSPECTING"
  | "PLANNING"
  | "DOWNLOADING"
  | "STAGING"
  | "APPLYING"
  | "PREPARING_RUNTIME"
  | "VERIFYING"
  | "COMMITTING"
  | "CLEANUP"
  | "COMPLETED"
  | "FAILED";

export interface InstallProgressDto {
  readonly phase: InstallProgressPhase;
  readonly operation: "install" | "update" | "repair" | "uninstall" | "move" | "status";
  readonly completedFiles?: number;
  readonly totalFiles?: number;
  readonly completedBytes?: number;
  readonly totalBytes?: number;
  /** Safe label — never a full filesystem path. */
  readonly currentItemLabel?: string;
  /** Only when totalFiles or totalBytes denominator is reliable. */
  readonly percent?: number;
  readonly indeterminate: boolean;
  /** Elapsed ms since mutation start (renderer-safe). */
  readonly elapsedMs?: number;
  /** Smoothed download throughput when byte metrics are active. */
  readonly bytesPerSecond?: number;
  /** Estimated remaining seconds — only when total bytes and speed are stable. */
  readonly etaSeconds?: number;
  /** When percent is set — whether it measures download bytes or processed files. */
  readonly metricScope?: "download" | "files";
}

export type InstallRecoverability = "NONE" | "BLOCKED" | "AUTO_HANDLED";

/** Semantic uninstall scope — renderer selects mode only, never a path. */
export type UninstallMode = "SAFE" | "COMPLETE";

export interface UninstallRequestDto {
  readonly mode: UninstallMode;
}

/**
 * Minecraft Java Edition public status (Server List Ping) — renderer-safe.
 * Produced only by Main against the product-configured address.
 */
export type ServerReachabilityState = "ONLINE" | "OFFLINE" | "UNKNOWN";

export interface ServerStatusDto {
  readonly state: ServerReachabilityState;
  /** Round-trip ms when measured; null if unavailable. */
  readonly latencyMs: number | null;
  readonly playersOnline: number | null;
  readonly playersMax: number | null;
  /** Safe short version label from status JSON — never raw dump. */
  readonly versionLabel: string | null;
  /** ISO timestamp of this observation. */
  readonly checkedAt: string;
  /** Echo of product-configured address (not renderer-controlled). */
  readonly address: string;
}

/** Safe account metadata only — never tokens. */
export interface SafeAccountDto {
  readonly accountId: string;
  readonly minecraftUsername: string;
  readonly minecraftUuid?: string;
  readonly lastUsedAtMs?: number;
}

/** @deprecated use SafeAccountDto — kept for transitional UI list typing */
export type AccountSummaryDto = SafeAccountDto & {
  readonly state?: AuthState;
};

export interface AuthStateDto {
  readonly state: AuthState;
  readonly selectedAccountId?: string;
  readonly account?: SafeAccountDto;
  readonly error?: UiError;
}

export type AuthProgressPhase =
  | "STARTING"
  | "OPENING_BROWSER"
  | "WAITING_FOR_CALLBACK"
  | "MICROSOFT_AUTHENTICATED"
  | "XBOX_AUTHENTICATING"
  | "MINECRAFT_AUTHENTICATING"
  | "CHECKING_ENTITLEMENT"
  | "LOADING_PROFILE"
  | "RESTORING"
  | "AUTHENTICATED"
  | "FAILED"
  | "CANCELLED";

export interface AuthProgressDto {
  readonly phase: AuthProgressPhase;
  readonly messageKey?: string;
}

export interface AuthActionResultDto {
  readonly state: AuthStateDto;
  readonly accounts: readonly SafeAccountDto[];
}

export interface AppInfoDto {
  readonly name: string;
  readonly version: string;
  readonly platform: string;
  readonly environment: "development" | "production";
  /** Git commit embedded at build time — distinguishes builds with identical SemVer. */
  readonly buildCommit?: string;
  /** `${semver}@${shortCommit}` (+dirty when applicable). */
  readonly buildId?: string;
  /** Present only when unpackaged fake harness(es) are active. */
  readonly features?: {
    readonly fakeAuthHarness?: boolean;
    readonly fakeInstallHarness?: boolean;
    readonly fakePlayHarness?: boolean;
  };
}

export interface LauncherStatusDto {
  readonly readiness: LauncherReadiness;
  readonly packVersion?: string;
  /** Alias of packVersion when known from 0.5A installedVersion. */
  readonly installedVersion?: string;
  readonly latestVersion?: string;
  readonly minecraftVersion?: string;
  readonly fabricVersion?: string;
  readonly channel?: string;
  readonly serverAddress: string;
  readonly gameState?: GameState;
  readonly operationState?: OperationState;
  /** Main-authoritative active mutation / status check. */
  readonly activeOperation?: InstallActiveOperation;
  readonly progress?: InstallProgressDto;
  readonly recoverability?: InstallRecoverability;
  /** Safe localized guidance key (recovery / checking / etc.). */
  readonly messageKey?: string;
}

export interface SettingsDto {
  readonly language: "fr";
  readonly reducedMotion: boolean;
  readonly memoryMiB?: number;
  /** Resolved authoritative SweetCraft instance root for Settings display (PACK-10.1G). */
  readonly sweetcraftInstancePath?: string;
  readonly instanceLocationConfigured?: boolean;
  readonly instanceLocationAvailable?: boolean;
}

/** Strict settings patch — no arbitrary key/value dictionary. */
export interface SettingsUpdateDto {
  readonly memoryMiB?: number;
  readonly reducedMotion?: boolean;
}

/**
 * System snapshot for Settings — no hostname, username, env, paths, or GPU shell-outs.
 */
export interface SystemInfoDto {
  readonly available: boolean;
  readonly platform: string;
  readonly arch: string;
  /** e.g. "Windows 10+" — never hostname/username. */
  readonly osLabel: string | null;
  readonly cpuModel: string | null;
  readonly cpuCount: number | null;
  readonly totalMemoryMiB: number | null;
  readonly freeMemoryMiB: number | null;
  /**
   * Always null on getInfo (0.6F.4 V3) — multi-disk via getFixedDisks.
   * Kept for DTO compatibility.
   */
  readonly diskTotalGiB: number | null;
  readonly diskFreeGiB: number | null;
  readonly launcherVersion: string;
  readonly checkedAtMs: number;
  /**
   * Advisory only — never auto-applied.
   * Formula: min(8192, max(2048, floor((total*0.35)/512)*512)) clamped to [512, 32768].
   */
  readonly recommendedMemoryMiB: number | null;
}

/** Single fixed local disk — letter + capacity only (no paths/serials/labels). */
export interface FixedDiskDto {
  readonly drive: string;
  readonly totalGiB: number;
  readonly freeGiB: number;
  readonly usedPercent: number;
  readonly isSweetCraftDrive: boolean;
}

/** Inventory from SYSTEM_GET_FIXED_DISKS — separate from getInfo hot path. */
export interface FixedDiskInventoryDto {
  readonly available: boolean;
  readonly disks: readonly FixedDiskDto[];
  readonly checkedAtMs: number;
}

/** Folder availability flags — instancePath only when Settings needs display via settings.get. */
export interface StorageSummaryDto {
  readonly instanceAvailable: boolean;
  readonly logsAvailable: boolean;
  /** True if launcher-data exists — open API still limited to instance + logs. */
  readonly launcherDataAvailable: boolean;
  readonly instanceLocationConfigured?: boolean;
  readonly instanceLocationAvailable?: boolean;
  /** Resolved instance root — legitimate for Settings display (PACK-10.1G). */
  readonly instancePath?: string;
}

export interface StorageOpenResultDto {
  readonly opened: boolean;
  readonly target: "instance" | "logs";
  readonly unavailable?: boolean;
}

/** Result of native folder selection — path validated by Main. */
export interface InstanceChooseLocationResultDto {
  readonly cancelled: boolean;
  readonly path?: string;
}

export interface InstanceSetLocationRequestDto {
  readonly path: string;
}

export interface InstanceMoveRequestDto {
  readonly destinationPath: string;
}

export interface InstanceLocationResultDto {
  readonly sweetcraftInstancePath: string;
  readonly instanceLocationConfigured: boolean;
  readonly instanceLocationAvailable: boolean;
}

/** Safe support diagnostics — no tokens, paths, env, command lines. */
export interface SafeDiagnosticsDto {
  readonly productName: string;
  readonly launcherVersion: string;
  /** Same provenance as AppInfoDto.buildId — optional when unavailable. */
  readonly buildId?: string;
  /** Full git SHA when available — same provenance as AppInfoDto.buildCommit. */
  readonly buildCommit?: string;
  readonly environment: "development" | "production";
  readonly platform: string;
  readonly architecture: string;
  readonly installReadiness: string;
  readonly installedPackVersion: string | null;
  readonly availablePackVersion: string | null;
  readonly minecraftVersion: string | null;
  readonly fabricVersion: string | null;
  readonly channel: string | null;
  readonly authState: string;
  readonly minecraftUsername: string | null;
  readonly playState: string;
  readonly gameRunning: boolean;
  readonly activeInstallOperation: string | null;
  readonly memoryMiB: number | null;
  readonly lastAuthErrorCode: string | null;
  readonly lastInstallErrorCode: string | null;
  readonly lastPlayErrorCode: string | null;
  readonly appIdBlocked: boolean;
  readonly fakeAuthHarness: boolean;
  readonly fakeInstallHarness: boolean;
  readonly fakePlayHarness: boolean;
  readonly supportId: string;
  /** Classification only — never dumps the custom absolute path here. */
  readonly instanceLocationConfigured?: boolean;
  /** Electron app.isPackaged — safe boolean. */
  readonly packaged?: boolean;
  /** Trusted-key load source classification — never an absolute path. */
  readonly trustedKeysSource?: "resources" | "app" | "missing";
  readonly trustedKeysPresent?: boolean;
  readonly rendererPresent?: boolean;
  readonly coreDistPresent?: boolean;
  readonly preloadPresent?: boolean;
  /** LIVE Microsoft auth allowed in this runtime context. */
  readonly liveAuthAllowed?: boolean;
  /** How public client id would resolve without printing the UUID when env-overridden. */
  readonly clientIdSource?: "product_default" | "env_override";
  /** Critical packaged init failure code, if any. */
  readonly criticalInitErrorCode?: string | null;
  /** Absolute user-data roots — allowed for support; never tokens. */
  readonly productUserDataRoot?: string | null;
  readonly launcherDataRoot?: string | null;
  readonly defaultInstanceRoot?: string | null;
  readonly defaultRuntimeRoot?: string | null;
  readonly dataRootSource?: "explicit" | "env" | "canonical" | "legacy-fallback" | null;
  /** Managed / system Java selection — paths and majors only, never tokens. */
  readonly javaSource?: "managed" | "JAVA_HOME" | "PATH" | "known_path" | "none" | null;
  readonly javaRequiredMajor?: number | null;
  readonly javaSelectedMajor?: number | null;
  readonly javaProvider?: string | null;
  readonly javaManagedIdentity?: string | null;
  readonly javaManagedRuntimeRoot?: string | null;
  readonly javaProvisioningState?: "idle" | "ready" | "missing" | null;
}

export interface DiagnosticsCopyResultDto {
  readonly copied: true;
  readonly textLength: number;
}

/** Safe error DTO — never includes stack, paths, tokens, env. */
export interface UiError {
  readonly code: string;
  readonly messageKey: string;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
}

/** Explicit IPC result envelope — do not rely on Electron Error serialization. */
export type IpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: UiError };

export function ipcOk<T>(value: T): IpcResult<T> {
  return { ok: true, value };
}

export function ipcErr(error: UiError): IpcResult<never> {
  return { ok: false, error };
}

export function isIpcResult(raw: unknown): raw is IpcResult<unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
  const o = raw as Record<string, unknown>;
  if (o["ok"] === true) return "value" in o;
  if (o["ok"] === false) {
    const err = o["error"];
    if (typeof err !== "object" || err === null) return false;
    const e = err as Record<string, unknown>;
    return typeof e["code"] === "string" && typeof e["messageKey"] === "string";
  }
  return false;
}

/** Explicit invoke channels — no generic command bus. */
export const IpcChannels = {
  APP_GET_INFO: "sc:app:getInfo",
  APP_MINIMIZE: "sc:app:minimize",
  APP_MAXIMIZE: "sc:app:maximize",
  APP_CLOSE: "sc:app:close",
  /** Legacy alias — same handler as INSTALL_GET_STATUS. */
  LAUNCHER_GET_STATUS: "sc:launcher:getStatus",
  INSTALL_GET_STATUS: "sc:install:getStatus",
  INSTALL_INSTALL: "sc:install:install",
  INSTALL_UPDATE: "sc:install:update",
  INSTALL_REPAIR: "sc:install:repair",
  INSTALL_UNINSTALL: "sc:install:uninstall",
  ACCOUNTS_LIST: "sc:accounts:list",
  ACCOUNTS_SELECT: "sc:accounts:select",
  SETTINGS_GET: "sc:settings:get",
  SETTINGS_UPDATE: "sc:settings:update",
  DIAGNOSTICS_GET: "sc:diagnostics:get",
  DIAGNOSTICS_COPY: "sc:diagnostics:copy",
  /** Public Minecraft server status — host fixed in Main (SWEETCRAFT_SERVER_ADDRESS). */
  SERVER_GET_STATUS: "sc:server:getStatus",
  /** System snapshot — Main-side only (node:os). Disks via SYSTEM_GET_FIXED_DISKS. */
  SYSTEM_GET_INFO: "sc:system:getInfo",
  /** Fixed local disks (Windows CIM) — empty invoke; no renderer path/args. */
  SYSTEM_GET_FIXED_DISKS: "sc:system:getFixedDisks",
  /** Storage flags only — no paths returned. */
  STORAGE_GET_SUMMARY: "sc:storage:getSummary",
  /** Open fixed instance folder — no path from renderer. */
  STORAGE_OPEN_INSTANCE: "sc:storage:openInstance",
  /** Open fixed instance logs folder — no path from renderer. */
  STORAGE_OPEN_LOGS: "sc:storage:openLogs",
  /** Native folder picker — returns validated path only (PACK-10.1G). */
  INSTANCE_CHOOSE_LOCATION: "sc:instance:chooseLocation",
  /** Set location when NOT_INSTALLED — validated path only (PACK-10.1G). */
  INSTANCE_SET_LOCATION: "sc:instance:setLocation",
  /** Move installed instance tree — validated destination only (PACK-10.1G). */
  INSTANCE_MOVE: "sc:instance:move",
  AUTH_GET_STATE: "sc:auth:getState",
  AUTH_RESTORE: "sc:auth:restore",
  AUTH_LOGIN: "sc:auth:login",
  AUTH_LOGOUT: "sc:auth:logout",
  /** Registered only when unpackaged + fake auth harness. */
  DEV_AUTH_SET_FIXTURE: "sc:dev:auth:setFixture",
  /** Registered only when unpackaged + fake install harness. */
  DEV_INSTALL_SET_FIXTURE: "sc:dev:install:setFixture",
  PLAY_GET_STATUS: "sc:play:getStatus",
  PLAY_START: "sc:play:start",
  /** Registered only when unpackaged + fake play harness. */
  DEV_PLAY_SET_FIXTURE: "sc:dev:play:setFixture",
  /** Fake-only: simulate Minecraft exit — NOT a real process kill API. */
  DEV_PLAY_SIMULATE_EXIT: "sc:dev:play:simulateExit"
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];

export const IpcEventChannels = {
  LAUNCHER_STATUS_CHANGED: "sc:event:launcherStatusChanged",
  INSTALL_PROGRESS: "sc:event:installProgress",
  PLAY_STATUS_CHANGED: "sc:event:playStatusChanged",
  NOTIFICATION: "sc:event:notification",
  AUTH_STATE_CHANGED: "sc:event:authStateChanged",
  AUTH_PROGRESS: "sc:event:authProgress"
} as const;

export type IpcEventChannel = (typeof IpcEventChannels)[keyof typeof IpcEventChannels];

export interface DesktopEventMap {
  launcherStatusChanged: LauncherStatusDto;
  installProgress: InstallProgressDto;
  playStatusChanged: PlayStatusDto;
  notification: {
    level: "INFO" | "SUCCESS" | "WARNING" | "ERROR";
    messageKey: string;
  };
  authStateChanged: AuthStateDto;
  authProgress: AuthProgressDto;
}

/** Preload → renderer API (window.sweetcraft). */
export interface SweetCraftDesktopApi {
  app: {
    getInfo(): Promise<AppInfoDto>;
    minimize(): Promise<void>;
    maximize(): Promise<void>;
    close(): Promise<void>;
  };
  launcher: {
    getStatus(): Promise<LauncherStatusDto>;
  };
  install: {
    getStatus(): Promise<LauncherStatusDto>;
    install(): Promise<LauncherStatusDto>;
    update(): Promise<LauncherStatusDto>;
    repair(): Promise<LauncherStatusDto>;
    uninstall(mode: UninstallMode): Promise<LauncherStatusDto>;
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
  /** Present only when Main registered the corresponding fake harness channel. */
  dev?: {
    setAuthFixture?(fixture: string): Promise<void>;
    setInstallFixture?(fixture: string): Promise<void>;
    setPlayFixture?(fixture: string): Promise<void>;
    /** Fake play only — simulate Minecraft exit. */
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
    /** Empty invoke — Main uses product-configured address only. */
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
  events: {
    onAuthStateChanged(listener: (payload: AuthStateDto) => void): () => void;
    onAuthProgress(listener: (payload: AuthProgressDto) => void): () => void;
    onInstallProgress(listener: (payload: InstallProgressDto) => void): () => void;
    onLauncherStatusChanged(listener: (payload: LauncherStatusDto) => void): () => void;
    onPlayStatusChanged(listener: (payload: PlayStatusDto) => void): () => void;
    onNotification(
      listener: (payload: DesktopEventMap["notification"]) => void
    ): () => void;
  };
}

export const SWEETCRAFT_SERVER_ADDRESS = "sweetcraft.datho.st";

/** @deprecated use EXTERNAL_URL_RULES from trust-policy — kept for path aliases */
export const EXTERNAL_URL_ALLOWLIST: readonly string[] = [
  "https://sweetcraft.datho.st/",
  "https://xbase.fr/",
  "https://www.xnosweet.fr/sweetcraft"
];

/** Forbidden secret field names in renderer-visible payloads (static/security tests). */
export const FORBIDDEN_AUTH_SECRET_KEYS = [
  "accessToken",
  "refreshToken",
  "xstsToken",
  "minecraftAccessToken",
  "authorizationCode",
  "codeVerifier",
  "clientSecret",
  "xboxToken"
] as const;
