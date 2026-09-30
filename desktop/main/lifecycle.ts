import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
  type WebContents
} from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  IpcChannels,
  IpcEventChannels,
  assertEmptyInvokePayload,
  assertUninstallPayload,
  createRendererTrustPolicyForRuntime,
  ipcErr,
  ipcOk,
  isAllowedExternalUrl,
  isAllowedNavigation,
  evaluateIpcSenderTrust,
  normalizeAccountList,
  normalizeAppInfo,
  normalizeLauncherStatus,
  normalizeNotificationEvent,
  normalizeSettings,
  normalizeUiError,
  resolveDesktopRuntimeMode as resolveDesktopRuntimeModePure,
  untrustedSenderError,
  toUiError,
  type AppInfoDto,
  type AuthStateDto,
  type DesktopRuntimeMode,
  type IpcResult,
  type LauncherReadiness,
  type LauncherStatusDto,
  type PlayStatusDto,
  type RendererTrustPolicy,
  type SettingsDto,
  type UiError,
  resolveDesktopResourcePaths,
  type DesktopResourcePaths,
  launcherDataDirFromUserData,
  assertInstancePathPayload,
  DEFAULT_INSTANCE_ID,
  LAUNCHER_DATA_DIR_NAME
} from "../shared/index.js";
import { resolveDesktopInstancePaths } from "../shared/instance-paths.js";
import { LAUNCHER_BUILD_COMMIT, LAUNCHER_BUILD_ID } from "../shared/build.generated.js";
import { DESKTOP_PRODUCT_NAME, DESKTOP_PRODUCT_VERSION } from "../shared/product.js";
import { getServerStatusService } from "./server-status/server-status-service.js";
import { collectSystemInfo } from "./system-info/system-info.js";
import { listFixedDisks } from "./system-info/fixed-disks.js";
import { getStorageSummary, openStorageTarget } from "./storage/storage-actions.js";
import {
  AuthDesktopService,
  FakeAuthBackend,
  EmptyAuthBackend,
  assertAccountIdPayload,
  assertLoginPayload,
  assertOptionalAccountIdPayload,
  assertFakeAuthFixturePayload,
  createRealAuthBackend,
  normalizeAuthActionResult,
  normalizeAuthStateDto,
  shouldUseFakeAuthBackend,
  tryNormalizeAuthProgressEvent,
  tryNormalizeAuthStateEvent,
  type AuthDesktopService as AuthServiceType,
  type FakeAuthBackend as FakeAuthBackendType
} from "./auth/index.js";
import {
  InstallDesktopService,
  FakeInstallBackend,
  EmptyInstallBackend,
  assertEmptyInstallPayload,
  assertFakeInstallFixturePayload,
  createRealInstallBackend,
  shouldUseFakeInstallBackend,
  tryNormalizeInstallProgressEvent,
  type InstallDesktopService as InstallServiceType,
  type FakeInstallBackend as FakeInstallBackendType
} from "./install/index.js";
import {
  PlayDesktopService,
  FakePlayBackend,
  EmptyPlayBackend,
  assertEmptyPlayPayload,
  assertFakePlayFixturePayload,
  assertSimulateExitPayload,
  createRealPlayBackend,
  shouldUseFakePlayBackend,
  tryNormalizePlayStatusEvent,
  type PlayDesktopService as PlayServiceType,
  type FakePlayBackend as FakePlayBackendType,
  type PlayEligibilityContext
} from "./play/index.js";
import {
  createSettingsDesktopService,
  type SettingsDesktopService
} from "./settings/index.js";
import {
  buildSafeDiagnostics,
  createEphemeralSupportId,
  formatDiagnosticsClipboardText
} from "./diagnostics/index.js";
import { createMainWindow, getMainWindow } from "./window.js";
import { InstanceLocationService } from "./instance/instance-location-service.js";

let activeTrustPolicy: RendererTrustPolicy | null = null;
let authService: AuthServiceType | null = null;
let fakeAuthBackend: FakeAuthBackendType | null = null;
let fakeAuthHarnessActive = false;
let installService: InstallServiceType | null = null;
let fakeInstallBackend: FakeInstallBackendType | null = null;
let fakeInstallHarnessActive = false;
let playService: PlayServiceType | null = null;
let fakePlayBackend: FakePlayBackendType | null = null;
let fakePlayHarnessActive = false;
let lastInstallReadiness: LauncherReadiness = "UNKNOWN";
let settingsService: SettingsDesktopService | null = null;
let instanceLocationService: InstanceLocationService | null = null;
/** Ephemeral support correlation id for this Main process lifetime. */
let sessionSupportId: string = createEphemeralSupportId();
/** Critical packaged init failure — fail-loud (safe code only). */
let criticalInitErrorCode: string | null = null;
let cachedResourcePaths: DesktopResourcePaths | null = null;

export function getActiveTrustPolicy(): RendererTrustPolicy | null {
  return activeTrustPolicy;
}

export function setActiveTrustPolicyForTests(policy: RendererTrustPolicy | null): void {
  activeTrustPolicy = policy;
}

export function getAuthServiceForTests(): AuthServiceType | null {
  return authService;
}

export function setAuthServiceForTests(svc: AuthServiceType | null): void {
  authService = svc;
}

export function isFakeAuthHarnessActiveForTests(): boolean {
  return fakeAuthHarnessActive;
}

export function getFakeAuthBackendForTests(): FakeAuthBackendType | null {
  return fakeAuthBackend;
}

export function getInstallServiceForTests(): InstallServiceType | null {
  return installService;
}

export function setInstallServiceForTests(svc: InstallServiceType | null): void {
  installService = svc;
}

export function isFakeInstallHarnessActiveForTests(): boolean {
  return fakeInstallHarnessActive;
}

export function getFakeInstallBackendForTests(): FakeInstallBackendType | null {
  return fakeInstallBackend;
}

export function getPlayServiceForTests(): PlayServiceType | null {
  return playService;
}

export function setPlayServiceForTests(svc: PlayServiceType | null): void {
  playService = svc;
}

export function isFakePlayHarnessActiveForTests(): boolean {
  return fakePlayHarnessActive;
}

export function getFakePlayBackendForTests(): FakePlayBackendType | null {
  return fakePlayBackend;
}

export function getLastInstallReadinessForTests(): LauncherReadiness {
  return lastInstallReadiness;
}

export function setLastInstallReadinessForTests(readiness: LauncherReadiness): void {
  lastInstallReadiness = readiness;
}

function productDataDir(): string {
  return launcherDataDirFromUserData(app.getPath("userData"));
}

function getConfiguredInstancePath(): string | null | undefined {
  return settingsService?.getPersistedInstancePath();
}

function resolveCurrentInstancePaths() {
  return resolveDesktopInstancePaths(app.getPath("userData"), getConfiguredInstancePath());
}

function getCurrentInstancePath(): string {
  return resolveCurrentInstancePaths().instancePath;
}

function isInstanceLocationUnavailable(): boolean {
  return resolveCurrentInstancePaths().locationUnavailable;
}

function enrichSettingsDto(base: SettingsDto): SettingsDto {
  const resolved = resolveCurrentInstancePaths();
  return {
    ...base,
    sweetcraftInstancePath: resolved.instancePath,
    instanceLocationConfigured: resolved.isConfigured,
    instanceLocationAvailable: !resolved.locationUnavailable
  };
}

function getDesktopResourcePaths(): DesktopResourcePaths {
  if (cachedResourcePaths) return cachedResourcePaths;
  cachedResourcePaths = resolveDesktopResourcePaths({
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath
  });
  return cachedResourcePaths;
}

/** Test-only: clear cached paths between cases. */
export function resetDesktopResourcePathsCacheForTests(): void {
  cachedResourcePaths = null;
}

function preloadPath(): string {
  return getDesktopResourcePaths().preloadPath;
}

function defaultIndexHtmlPath(): string {
  return getDesktopResourcePaths().rendererIndexHtml;
}

function distRootPath(): string {
  return getDesktopResourcePaths().distRoot;
}

function trustedKeysPath(): string {
  return getDesktopResourcePaths().trustedKeysPath;
}

function recordCriticalInitFailure(code: string): void {
  if (!criticalInitErrorCode) criticalInitErrorCode = code;
  try {
    sendNotification("ERROR", "error.desktop.init_failed");
  } catch {
    // Notification channel may not be ready during early init.
  }
}

export function resolveDesktopRuntimeMode(opts?: {
  isPackaged?: boolean;
  envOverride?: string | undefined;
}): DesktopRuntimeMode {
  return resolveDesktopRuntimeModePure({
    isPackaged: opts?.isPackaged ?? app.isPackaged,
    envOverride: opts?.envOverride ?? process.env.SWEETCRAFT_DESKTOP_ENV
  });
}

export function buildTrustPolicy(
  mode: DesktopRuntimeMode,
  opts?: { isPackaged?: boolean; devServerUrl?: string | undefined }
): RendererTrustPolicy {
  const packaged = opts?.isPackaged ?? app.isPackaged;
  return createRendererTrustPolicyForRuntime({
    isPackaged: packaged,
    indexHtmlPath: defaultIndexHtmlPath(),
    envOverride: packaged
      ? "production"
      : mode === "production"
        ? "production"
        : process.env.SWEETCRAFT_DESKTOP_ENV,
    devServerUrl: opts?.devServerUrl ?? process.env.DESKTOP_DEV_SERVER
  });
}

function getAppInfo(mode: DesktopRuntimeMode): AppInfoDto {
  const base = {
    name: DESKTOP_PRODUCT_NAME,
    version: DESKTOP_PRODUCT_VERSION,
    platform: process.platform,
    environment: mode,
    buildCommit: LAUNCHER_BUILD_COMMIT,
    buildId: LAUNCHER_BUILD_ID
  };
  if (fakeAuthHarnessActive || fakeInstallHarnessActive || fakePlayHarnessActive) {
    const features: {
      fakeAuthHarness?: boolean;
      fakeInstallHarness?: boolean;
      fakePlayHarness?: boolean;
    } = {};
    if (fakeAuthHarnessActive) features.fakeAuthHarness = true;
    if (fakeInstallHarnessActive) features.fakeInstallHarness = true;
    if (fakePlayHarnessActive) features.fakePlayHarness = true;
    return normalizeAppInfo({ ...base, features });
  }
  return normalizeAppInfo(base);
}

async function getLauncherStatus(): Promise<LauncherStatusDto> {
  return requireInstall().getStatus();
}

function getSettings(): SettingsDto {
  if (!settingsService) {
    return enrichSettingsDto(
      normalizeSettings({
        language: "fr",
        reducedMotion: false,
        memoryMiB: 2048
      })
    );
  }
  return enrichSettingsDto(normalizeSettings(settingsService.get()));
}

function requireSettings(): SettingsDesktopService {
  if (!settingsService) {
    throw normalizeUiError({
      code: "INTERNAL_ERROR",
      messageKey: "error.settings.unavailable"
    });
  }
  return settingsService;
}

function requireInstanceLocation(): InstanceLocationService {
  if (!instanceLocationService) {
    throw normalizeUiError({
      code: "INTERNAL_ERROR",
      messageKey: "error.instance.location.unavailable"
    });
  }
  return instanceLocationService;
}

async function collectSafeDiagnostics(mode: DesktopRuntimeMode) {
  let status: LauncherStatusDto | null = null;
  let auth: AuthStateDto | null = null;
  let play: PlayStatusDto | null = null;
  try {
    if (installService) status = await installService.getStatus();
  } catch {
    status = null;
  }
  try {
    if (authService) auth = await authService.getState();
  } catch {
    auth = null;
  }
  try {
    if (playService) play = await playService.getStatus();
  } catch {
    play = null;
  }
  return buildSafeDiagnostics({
    info: getAppInfo(mode),
    status,
    auth,
    play,
    settings: getSettings(),
    supportId: sessionSupportId,
    platform: process.platform,
    architecture: process.arch,
    lastAuthErrorCode: auth?.error?.code ?? null,
    lastInstallErrorCode: status?.readiness === "ERROR" ? (status.messageKey ?? null) : null,
    lastPlayErrorCode: play?.error?.code ?? null,
    packaged: app.isPackaged,
    trustedKeysSource: fs.existsSync(trustedKeysPath())
      ? getDesktopResourcePaths().trustedKeysSource
      : "missing",
    trustedKeysPresent: fs.existsSync(trustedKeysPath()),
    rendererPresent: fs.existsSync(defaultIndexHtmlPath()),
    coreDistPresent: fs.existsSync(path.join(distRootPath(), "auth", "index.js")),
    preloadPresent: fs.existsSync(preloadPath()),
    liveAuthAllowed: app.isPackaged || process.env.SWEETCRAFT_ALLOW_LIVE_AUTH === "1",
    clientIdSource:
      typeof process.env.SWEETCRAFT_MICROSOFT_CLIENT_ID === "string" &&
      process.env.SWEETCRAFT_MICROSOFT_CLIENT_ID.trim()
        ? "env_override"
        : "product_default",
    criticalInitErrorCode,
    productUserDataRoot: app.getPath("userData"),
    launcherDataRoot: productDataDir(),
    defaultInstanceRoot: getCurrentInstancePath(),
    defaultRuntimeRoot: path.join(productDataDir(), "runtime"),
    dataRootSource: "canonical"
  });
}

function requireAuth(): AuthServiceType {
  if (!authService) {
    throw normalizeUiError({
      code: "AUTH_SESSION_ERROR",
      messageKey: "error.auth_error"
    });
  }
  return authService;
}

function requireInstall(): InstallServiceType {
  if (!installService) {
    throw normalizeUiError({
      code: "INTERNAL_ERROR",
      messageKey: "install.message.status_unknown"
    });
  }
  return installService;
}

function requirePlay(): PlayServiceType {
  if (!playService) {
    throw normalizeUiError({
      code: "INTERNAL_ERROR",
      messageKey: "play.message.unavailable"
    });
  }
  return playService;
}

function assertInstallNotBlockedByPlay(): void {
  if (playService?.isPlayBusy()) {
    throw toUiError("INSTANCE_BUSY", "error.install.busy");
  }
}

function assertAuthNotBlockedByPlay(): void {
  if (playService?.isPlayBusy()) {
    throw toUiError("GAME_ALREADY_RUNNING", "error.play.already_running");
  }
}

function sendAuthState(state: AuthStateDto): void {
  const normalized = tryNormalizeAuthStateEvent(state);
  if (!normalized) return;
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IpcEventChannels.AUTH_STATE_CHANGED, normalized);
}

function sendAuthProgress(raw: unknown): void {
  const normalized = tryNormalizeAuthProgressEvent(raw);
  if (!normalized) return;
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IpcEventChannels.AUTH_PROGRESS, normalized);
}

function sendInstallStatus(status: LauncherStatusDto): void {
  let normalized: LauncherStatusDto;
  try {
    normalized = normalizeLauncherStatus(status);
  } catch {
    return;
  }
  lastInstallReadiness = normalized.readiness;
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IpcEventChannels.LAUNCHER_STATUS_CHANGED, normalized);
}

function sendPlayStatus(status: PlayStatusDto): void {
  const normalized = tryNormalizePlayStatusEvent(status);
  if (!normalized) return;
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IpcEventChannels.PLAY_STATUS_CHANGED, normalized);
}

function sendInstallProgress(raw: unknown): void {
  const normalized = tryNormalizeInstallProgressEvent(raw);
  if (!normalized) return;
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IpcEventChannels.INSTALL_PROGRESS, normalized);
}

function sendNotification(
  level: "INFO" | "SUCCESS" | "WARNING" | "ERROR",
  messageKey: string
): void {
  let normalized: ReturnType<typeof normalizeNotificationEvent>;
  try {
    normalized = normalizeNotificationEvent({ level, messageKey });
  } catch {
    return;
  }
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IpcEventChannels.NOTIFICATION, normalized);
}

/**
 * Fail-closed IPC caller authorization.
 */
export function assertTrustedIpcSender(
  event: IpcMainInvokeEvent,
  policy: RendererTrustPolicy | null = activeTrustPolicy
): void {
  const main = getMainWindow();
  const senderIsMainWindow = Boolean(
    main && !main.isDestroyed() && event.sender === main.webContents
  );
  const frame = event.senderFrame;
  const mainFrame = event.sender.mainFrame;
  const isTopFrame = Boolean(frame && mainFrame && frame === mainFrame);
  const frameUrl = frame?.url ?? "";

  if (
    !evaluateIpcSenderTrust({
      policy,
      senderIsMainWindow,
      isTopFrame,
      frameUrl
    })
  ) {
    throw untrustedSenderError();
  }
}

type Handler = (payload: unknown) => Promise<unknown> | unknown;

function makeHandlers(mode: DesktopRuntimeMode): Record<string, Handler> {
  const handlers: Record<string, Handler> = {
    [IpcChannels.APP_GET_INFO]: (p) => {
      assertEmptyInvokePayload(p);
      return getAppInfo(mode);
    },
    [IpcChannels.APP_MINIMIZE]: (p) => {
      assertEmptyInvokePayload(p);
      getMainWindow()?.minimize();
    },
    [IpcChannels.APP_MAXIMIZE]: (p) => {
      assertEmptyInvokePayload(p);
      const win = getMainWindow();
      if (!win) return;
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    },
    [IpcChannels.APP_CLOSE]: (p) => {
      assertEmptyInvokePayload(p);
      getMainWindow()?.close();
    },
    [IpcChannels.LAUNCHER_GET_STATUS]: async (p) => {
      assertEmptyInvokePayload(p);
      return getLauncherStatus();
    },
    [IpcChannels.INSTALL_GET_STATUS]: async (p) => {
      assertEmptyInstallPayload(p);
      return requireInstall().getStatus();
    },
    [IpcChannels.INSTALL_INSTALL]: async (p) => {
      assertEmptyInstallPayload(p);
      assertInstallNotBlockedByPlay();
      return requireInstall().install();
    },
    [IpcChannels.INSTALL_UPDATE]: async (p) => {
      assertEmptyInstallPayload(p);
      assertInstallNotBlockedByPlay();
      return requireInstall().update();
    },
    [IpcChannels.INSTALL_REPAIR]: async (p) => {
      assertEmptyInstallPayload(p);
      assertInstallNotBlockedByPlay();
      return requireInstall().repair();
    },
    [IpcChannels.INSTALL_UNINSTALL]: async (p) => {
      const mode = assertUninstallPayload(p);
      assertInstallNotBlockedByPlay();
      return requireInstall().uninstall(mode);
    },
    [IpcChannels.PLAY_GET_STATUS]: async (p) => {
      assertEmptyPlayPayload(p);
      return requirePlay().getStatus();
    },
    [IpcChannels.PLAY_START]: async (p) => {
      assertEmptyPlayPayload(p);
      return requirePlay().start();
    },
    [IpcChannels.ACCOUNTS_LIST]: async (p) => {
      assertEmptyInvokePayload(p);
      const list = await requireAuth().listAccounts();
      return normalizeAccountList(list);
    },
    [IpcChannels.ACCOUNTS_SELECT]: async (p) => {
      assertAuthNotBlockedByPlay();
      const accountId = assertAccountIdPayload(p);
      const result = await requireAuth().select(accountId);
      return normalizeAuthActionResult(result);
    },
    [IpcChannels.AUTH_GET_STATE]: (p) => {
      assertEmptyInvokePayload(p);
      return normalizeAuthStateDto(requireAuth().getState());
    },
    [IpcChannels.AUTH_RESTORE]: async (p) => {
      const accountId = assertOptionalAccountIdPayload(p);
      const result = await requireAuth().restore(accountId);
      return normalizeAuthActionResult(result);
    },
    [IpcChannels.AUTH_LOGIN]: async (p) => {
      assertLoginPayload(p);
      const result = await requireAuth().login();
      return normalizeAuthActionResult(result);
    },
    [IpcChannels.AUTH_LOGOUT]: async (p) => {
      assertAuthNotBlockedByPlay();
      const accountId = assertAccountIdPayload(p);
      const result = await requireAuth().logout(accountId);
      return normalizeAuthActionResult(result);
    },
    [IpcChannels.SETTINGS_GET]: (p) => {
      assertEmptyInvokePayload(p);
      return getSettings();
    },
    [IpcChannels.SETTINGS_UPDATE]: (p) => {
      return normalizeSettings(requireSettings().update(p));
    },
    [IpcChannels.DIAGNOSTICS_GET]: async (p) => {
      assertEmptyInvokePayload(p);
      return collectSafeDiagnostics(mode);
    },
    [IpcChannels.DIAGNOSTICS_COPY]: async (p) => {
      assertEmptyInvokePayload(p);
      const dto = await collectSafeDiagnostics(mode);
      const text = formatDiagnosticsClipboardText(dto);
      clipboard.writeText(text);
      return { copied: true as const, textLength: text.length };
    },
    [IpcChannels.SERVER_GET_STATUS]: async (p) => {
      // Host is never taken from payload — product constant only.
      assertEmptyInvokePayload(p);
      return getServerStatusService().getStatus();
    },
    [IpcChannels.SYSTEM_GET_INFO]: async (p) => {
      assertEmptyInvokePayload(p);
      // No disk probe here — multi-disk is SYSTEM_GET_FIXED_DISKS.
      return collectSystemInfo({
        launcherVersion: DESKTOP_PRODUCT_VERSION
      });
    },
    [IpcChannels.SYSTEM_GET_FIXED_DISKS]: async (p) => {
      assertEmptyInvokePayload(p);
      return listFixedDisks({
        userData: app.getPath("userData"),
        instancePath: getCurrentInstancePath()
      });
    },
    [IpcChannels.STORAGE_GET_SUMMARY]: (p) => {
      assertEmptyInvokePayload(p);
      const configured = getConfiguredInstancePath();
      return getStorageSummary(
        app.getPath("userData"),
        configured === undefined ? null : configured
      );
    },
    [IpcChannels.STORAGE_OPEN_INSTANCE]: async (p) => {
      assertEmptyInvokePayload(p);
      const configured = getConfiguredInstancePath();
      return openStorageTarget({
        userData: app.getPath("userData"),
        ...(configured !== undefined ? { configuredInstancePath: configured } : {}),
        target: "instance",
        openPath: (abs) => shell.openPath(abs)
      });
    },
    [IpcChannels.STORAGE_OPEN_LOGS]: async (p) => {
      assertEmptyInvokePayload(p);
      const configured = getConfiguredInstancePath();
      return openStorageTarget({
        userData: app.getPath("userData"),
        ...(configured !== undefined ? { configuredInstancePath: configured } : {}),
        target: "logs",
        openPath: (abs) => shell.openPath(abs)
      });
    },
    [IpcChannels.INSTANCE_CHOOSE_LOCATION]: async (p) => {
      assertEmptyInvokePayload(p);
      return requireInstanceLocation().chooseLocation();
    },
    [IpcChannels.INSTANCE_SET_LOCATION]: async (p) => {
      const chosen = assertInstancePathPayload(p);
      return requireInstanceLocation().setLocation(chosen);
    },
    [IpcChannels.INSTANCE_MOVE]: async (p) => {
      const destination = assertInstancePathPayload(p);
      return requireInstanceLocation().moveInstance(destination);
    }
  };

  if (fakeAuthHarnessActive && fakeAuthBackend) {
    handlers[IpcChannels.DEV_AUTH_SET_FIXTURE] = async (p) => {
      const fixture = assertFakeAuthFixturePayload(p);
      fakeAuthBackend!.applyFixture(fixture);
      return null;
    };
  }

  if (fakeInstallHarnessActive && fakeInstallBackend) {
    handlers[IpcChannels.DEV_INSTALL_SET_FIXTURE] = async (p) => {
      const fixture = assertFakeInstallFixturePayload(p);
      fakeInstallBackend!.applyFixture(fixture);
      return requireInstall().getStatus();
    };
  }

  if (fakePlayHarnessActive && fakePlayBackend) {
    handlers[IpcChannels.DEV_PLAY_SET_FIXTURE] = async (p) => {
      const fixture = assertFakePlayFixturePayload(p);
      fakePlayBackend!.applyFixture(fixture);
      return requirePlay().getStatus();
    };
    handlers[IpcChannels.DEV_PLAY_SIMULATE_EXIT] = async (p) => {
      const opts = assertSimulateExitPayload(p);
      return requirePlay().simulateFakeExit(opts.exitCode);
    };
  }

  return handlers;
}

function registerIpc(mode: DesktopRuntimeMode): void {
  // Drop any previously registered handlers (incl. stale dev fixture channel).
  for (const channel of Object.values(IpcChannels)) {
    ipcMain.removeHandler(channel);
  }
  const handlers = makeHandlers(mode);
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (event, payload: unknown): Promise<IpcResult<unknown>> => {
      try {
        assertTrustedIpcSender(event);
        const value = await handler(payload);
        return ipcOk(value ?? null);
      } catch (e) {
        const err = normalizeUiError(e);
        const safe: UiError = { code: err.code, messageKey: err.messageKey };
        if (err.details) (safe as { details?: UiError["details"] }).details = err.details;
        return ipcErr(safe);
      }
    });
  }
}

async function initInstallService(): Promise<void> {
  const sink = {
    onStatus: (s: LauncherStatusDto) => sendInstallStatus(s),
    onProgress: (p: unknown) => sendInstallProgress(p),
    onNotification: (level: "INFO" | "SUCCESS" | "WARNING" | "ERROR", messageKey: string) =>
      sendNotification(level, messageKey)
  };

  fakeInstallBackend = null;
  fakeInstallHarnessActive = false;

  const packaged = app.isPackaged;
  const useFake = shouldUseFakeInstallBackend({
    isPackaged: packaged,
    fakeEnv: process.env.SWEETCRAFT_DESKTOP_INSTALL_FAKE
  });

  if (useFake) {
    const persistDir = path.join(app.getPath("userData"), "dev-fake-install");
    fakeInstallBackend = new FakeInstallBackend({ persistDir });
    fakeInstallHarnessActive = true;
    installService = new InstallDesktopService(fakeInstallBackend, sink);
    return;
  }

  try {
    const dataDir = productDataDir();
    const distRoot = distRootPath();
    const keysPath = trustedKeysPath();
    const keysPresent = fs.existsSync(keysPath);
    if (!keysPresent && packaged) {
      recordCriticalInitFailure("TRUSTED_KEYS_MISSING");
      throw new Error("TRUSTED_KEYS_MISSING");
    }
    // Unpackaged/dev: skip Mojang pulls when keys absent (local safety).
    const skipRuntimePrep = !keysPresent;
    if (!fs.existsSync(path.join(distRoot, "application", "index.js"))) {
      if (packaged) recordCriticalInitFailure("CORE_RUNTIME_MISSING");
      throw new Error("CORE_RUNTIME_MISSING");
    }
    const backend = await createRealInstallBackend({
      dataDir,
      getInstancePath: getCurrentInstancePath,
      getLocationUnavailable: isInstanceLocationUnavailable,
      runtimePath: path.join(dataDir, "runtime"),
      distRoot,
      trustedKeysPath: keysPath,
      skipRuntimePrep
    });
    installService = new InstallDesktopService(backend, sink);
  } catch (e) {
    if (packaged) {
      if (!criticalInitErrorCode) {
        recordCriticalInitFailure("INSTALL_BACKEND_UNAVAILABLE");
      }
      // Packaged: do not silently pretend install works — Empty backend + critical flag.
      installService = new InstallDesktopService(new EmptyInstallBackend(), sink);
      return;
    }
    installService = new InstallDesktopService(new EmptyInstallBackend(), sink);
  }
}

function buildPlayEligibilityContext(): PlayEligibilityContext {
  return {
    getInstallReadiness: () => lastInstallReadiness,
    isInstallMutationBusy: () => installService?.isMutationBusy() ?? false,
    getAuthenticatedAccount: () => {
      const auth = authService?.getState();
      if (!auth || auth.state !== "AUTHENTICATED" || !auth.account) {
        return null;
      }
      return {
        accountId: auth.account.accountId,
        minecraftUsername: auth.account.minecraftUsername
      };
    },
    refreshInstallStatus: async () => {
      if (!installService) return;
      const status = await installService.getStatus();
      lastInstallReadiness = status.readiness;
    }
  };
}

async function initPlayService(): Promise<void> {
  const sink = {
    onStatus: (s: PlayStatusDto) => sendPlayStatus(s),
    onNotification: (level: "INFO" | "SUCCESS" | "WARNING" | "ERROR", messageKey: string) =>
      sendNotification(level, messageKey)
  };

  fakePlayBackend = null;
  fakePlayHarnessActive = false;

  const eligibility = buildPlayEligibilityContext();
  const packaged = app.isPackaged;
  const useFake = shouldUseFakePlayBackend({
    isPackaged: packaged,
    fakeEnv: process.env.SWEETCRAFT_DESKTOP_PLAY_FAKE
  });

  if (useFake) {
    const persistDir = path.join(app.getPath("userData"), "dev-fake-play");
    fakePlayBackend = new FakePlayBackend({ persistDir });
    fakePlayHarnessActive = true;
    playService = new PlayDesktopService(fakePlayBackend, eligibility, sink);
    await playService.restoreOnBootstrap();
    return;
  }

  try {
    const dataDir = productDataDir();
    const runtimePath = path.join(dataDir, "runtime");
    const keysPath = trustedKeysPath();
    if (packaged && !fs.existsSync(keysPath)) {
      recordCriticalInitFailure("TRUSTED_KEYS_MISSING");
      throw new Error("TRUSTED_KEYS_MISSING");
    }
    if (!fs.existsSync(path.join(distRootPath(), "application", "play", "index.js"))) {
      if (packaged) recordCriticalInitFailure("CORE_RUNTIME_MISSING");
      throw new Error("CORE_RUNTIME_MISSING");
    }
    const backend = await createRealPlayBackend({
      dataDir,
      getInstancePath: getCurrentInstancePath,
      runtimePath,
      distRoot: distRootPath(),
      trustedKeysPath: keysPath,
      getMemoryMiB: () => settingsService?.getMemoryMiB()
    });
    playService = new PlayDesktopService(backend, eligibility, sink);
  } catch {
    if (packaged && !criticalInitErrorCode) {
      recordCriticalInitFailure("PLAY_BACKEND_UNAVAILABLE");
    }
    playService = new PlayDesktopService(new EmptyPlayBackend(), eligibility, sink);
  }
  await playService.restoreOnBootstrap();
}

async function initAuthService(): Promise<void> {
  const sink = {
    onState: (s: AuthStateDto) => sendAuthState(s),
    onProgress: (p: unknown) => sendAuthProgress(p)
  };

  fakeAuthBackend = null;
  fakeAuthHarnessActive = false;

  const packaged = app.isPackaged;
  const useFake = shouldUseFakeAuthBackend({
    isPackaged: packaged,
    fakeEnv: process.env.SWEETCRAFT_DESKTOP_AUTH_FAKE
  });

  if (useFake) {
    const persistDir = path.join(app.getPath("userData"), "dev-fake-auth");
    fakeAuthBackend = new FakeAuthBackend({ persistDir });
    fakeAuthHarnessActive = true;
    authService = new AuthDesktopService(fakeAuthBackend, sink);
    return;
  }

  try {
    const dataDir = productDataDir();
    if (!fs.existsSync(path.join(distRootPath(), "auth", "index.js"))) {
      if (packaged) recordCriticalInitFailure("CORE_RUNTIME_MISSING");
      throw new Error("CORE_RUNTIME_MISSING");
    }
    const backend = await createRealAuthBackend({
      dataDir,
      distRoot: distRootPath(),
      ...(packaged ? { packagedProduction: true } : {})
    });
    authService = new AuthDesktopService(backend, sink);
  } catch {
    if (packaged) {
      if (!criticalInitErrorCode) recordCriticalInitFailure("AUTH_BACKEND_UNAVAILABLE");
      authService = new AuthDesktopService(new EmptyAuthBackend(), sink);
      return;
    }
    // Unpackaged: fail soft so shell still boots — never FakeAuthBackend in packaged builds.
    authService = new AuthDesktopService(new EmptyAuthBackend(), sink);
  }
}

export async function openExternalSafe(url: string): Promise<boolean> {
  if (!isAllowedExternalUrl(url)) return false;
  await shell.openExternal(url);
  return true;
}

export function attachNavigationGuards(
  contents: WebContents,
  policy: RendererTrustPolicy
): void {
  contents.setWindowOpenHandler(({ url }) => {
    void openExternalSafe(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (isAllowedNavigation(policy, url)) {
      return;
    }
    event.preventDefault();
    void openExternalSafe(url);
  });
}

function loadFromPolicy(win: BrowserWindow, policy: RendererTrustPolicy): void {
  if (policy.target.kind === "dev-server") {
    void win.loadURL(policy.target.url);
  } else {
    void win.loadFile(policy.target.indexHtmlPath);
  }
}

export async function bootstrapDesktop(): Promise<void> {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }
  app.on("second-instance", () => {
    const win = getMainWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  await app.whenReady();

  const mode = resolveDesktopRuntimeMode();
  const policy = buildTrustPolicy(mode);
  activeTrustPolicy = policy;

  const dataDir = productDataDir();
  settingsService = createSettingsDesktopService(dataDir);
  sessionSupportId = createEphemeralSupportId();

  await Promise.all([initAuthService(), initInstallService(), initPlayService()]);

  instanceLocationService = new InstanceLocationService({
    userData: app.getPath("userData"),
    productUserDataRoot: app.getPath("userData"),
    distRoot: distRootPath(),
    applicationDirectory: app.getAppPath(),
    getSettings: requireSettings,
    getInstall: () => installService,
    getPlay: () => playService,
    getBrowserWindow: () => getMainWindow(),
    onProgress: (p) => sendInstallProgress(p),
    onLocationChanged: async () => {
      try {
        const s = await requireInstall().getStatus();
        lastInstallReadiness = s.readiness;
        sendInstallStatus(s);
      } catch {
        // best-effort refresh after location change
      }
    },
    onNotification: (level, messageKey) => sendNotification(level, messageKey)
  });
  registerIpc(mode);

  const win = createMainWindow({
    preloadPath: preloadPath(),
    policy
  });
  attachNavigationGuards(win.webContents, policy);
  loadFromPolicy(win, policy);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const w = createMainWindow({
        preloadPath: preloadPath(),
        policy
      });
      attachNavigationGuards(w.webContents, policy);
      loadFromPolicy(w, policy);
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
