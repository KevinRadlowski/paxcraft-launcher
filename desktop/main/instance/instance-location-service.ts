/**
 * PACK-10.1G — instance location picker, set, and move orchestration (Main-only).
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { BrowserWindow } from "electron";
import { dialog } from "electron";
import type {
  InstanceChooseLocationResultDto,
  InstanceLocationResultDto,
  InstallProgressDto
} from "../../shared/contract.js";
import { toUiError } from "../../shared/validate.js";
import { resolveDesktopInstancePaths } from "../../shared/instance-paths.js";
import type { SettingsDesktopService } from "../settings/settings-service.js";
import type { InstallDesktopService } from "../install/install-desktop-service.js";
import type { PlayDesktopService } from "../play/play-desktop-service.js";

type PathsModule = {
  buildInstancePathGuardContext: (
    launcherDataRoot: string,
    productUserDataRoot: string,
    applicationDirectory?: string
  ) => unknown;
  validateInstancePathCandidate: (
    raw: string,
    guard: unknown,
    opts?: { sourceRoot?: string }
  ) => { ok: boolean; canonicalPath?: string; reason?: string };
  assertFreshInstallLocationAllowed: (instanceRoot: string) => void;
};

type MoveModule = {
  moveInstanceTree: (opts: Record<string, unknown>) => Promise<{ destinationRoot: string }>;
};

export interface InstanceLocationServiceDeps {
  readonly userData: string;
  readonly productUserDataRoot: string;
  readonly distRoot: string;
  readonly applicationDirectory?: string;
  readonly getSettings: () => SettingsDesktopService;
  readonly getInstall: () => InstallDesktopService | null;
  readonly getPlay: () => PlayDesktopService | null;
  readonly getBrowserWindow: () => BrowserWindow | null;
  readonly onProgress?: (p: InstallProgressDto) => void;
  /** Must settle before setLocation/moveInstance return — install may follow immediately. */
  readonly onLocationChanged?: () => void | Promise<void>;
  readonly onNotification?: (
    level: "INFO" | "SUCCESS" | "WARNING" | "ERROR",
    messageKey: string
  ) => void;
}

export class InstanceLocationService {
  private moving = false;
  private pathsMod: PathsModule | null = null;
  private moveMod: MoveModule | null = null;

  constructor(private readonly deps: InstanceLocationServiceDeps) {}

  private async paths(): Promise<PathsModule> {
    if (!this.pathsMod) {
      this.pathsMod = (await import(
        pathToFileURL(path.join(this.deps.distRoot, "instance", "paths", "index.js")).href
      )) as PathsModule;
    }
    return this.pathsMod;
  }

  private async move(): Promise<MoveModule> {
    if (!this.moveMod) {
      this.moveMod = (await import(
        pathToFileURL(path.join(this.deps.distRoot, "instance", "move", "index.js")).href
      )) as MoveModule;
    }
    return this.moveMod;
  }

  private resolvePaths() {
    const settings = this.deps.getSettings();
    const persisted = settings.getPersistedInstancePath();
    return resolveDesktopInstancePaths(this.deps.userData, persisted);
  }

  private buildGuard(pathsMod: PathsModule) {
    const resolved = resolveDesktopInstancePaths(this.deps.userData, null);
    return pathsMod.buildInstancePathGuardContext(
      resolved.dataDir,
      this.deps.productUserDataRoot,
      this.deps.applicationDirectory
    );
  }

  private toResultDto(): InstanceLocationResultDto {
    const resolved = this.resolvePaths();
    return {
      sweetcraftInstancePath: resolved.instancePath,
      instanceLocationConfigured: resolved.isConfigured,
      instanceLocationAvailable: !resolved.locationUnavailable
    };
  }

  private assertNotBusy(): void {
    const install = this.deps.getInstall();
    if (install?.isMutationBusy()) {
      throw toUiError("INSTANCE_BUSY", "error.instance.location.busy");
    }
    if (this.moving) {
      throw toUiError("INSTANCE_BUSY", "error.instance.location.busy");
    }
    const play = this.deps.getPlay();
    const playState = play?.getLastStatus()?.state;
    if (playState === "RUNNING" || playState === "LAUNCHING") {
      throw toUiError("GAME_ALREADY_RUNNING", "error.instance.location.game_running");
    }
  }

  async chooseLocation(): Promise<InstanceChooseLocationResultDto> {
    this.assertNotBusy();
    const win = this.deps.getBrowserWindow();
    const dialogOpts = {
      properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[],
      title: "Choisir l'emplacement de SweetCraft"
    };
    const result = win
      ? await dialog.showOpenDialog(win, dialogOpts)
      : await dialog.showOpenDialog(dialogOpts);
    if (result.canceled || !result.filePaths[0]) {
      return { cancelled: true };
    }
    const pathsMod = await this.paths();
    const guard = this.buildGuard(pathsMod);
    const validation = pathsMod.validateInstancePathCandidate(result.filePaths[0]!, guard);
    if (!validation.ok || !validation.canonicalPath) {
      throw toUiError("INSTANCE_LOCATION_INVALID", "error.instance.location.invalid", {
        reason: validation.reason ?? "invalid"
      });
    }
    return { cancelled: false, path: validation.canonicalPath };
  }

  async setLocation(rawPath: string): Promise<InstanceLocationResultDto> {
    this.assertNotBusy();
    const install = this.deps.getInstall();
    const status = install ? await install.getStatus() : null;
    if (
      status &&
      status.readiness !== "NOT_INSTALLED" &&
      status.readiness !== "LOCATION_UNAVAILABLE"
    ) {
      throw toUiError("INSTANCE_ALREADY_INSTALLED", "error.instance.location.installed_use_move");
    }

    const pathsMod = await this.paths();
    const guard = this.buildGuard(pathsMod);
    const validation = pathsMod.validateInstancePathCandidate(rawPath, guard);
    if (!validation.ok || !validation.canonicalPath) {
      throw toUiError("INSTANCE_LOCATION_INVALID", "error.instance.location.invalid", {
        reason: validation.reason ?? "invalid"
      });
    }

    try {
      pathsMod.assertFreshInstallLocationAllowed(validation.canonicalPath);
    } catch (e) {
      throw mapLocationPolicyError(e);
    }

    this.deps.getSettings().setPersistedInstancePath(validation.canonicalPath);
    await this.deps.onLocationChanged?.();
    return this.toResultDto();
  }

  async moveInstance(destinationPath: string): Promise<InstanceLocationResultDto> {
    this.assertNotBusy();
    const install = this.deps.getInstall();
    const status = install ? await install.getStatus() : null;
    if (
      !status ||
      (status.readiness !== "READY" &&
        status.readiness !== "UPDATE_AVAILABLE" &&
        status.readiness !== "REPAIR_REQUIRED")
    ) {
      throw toUiError("INSTANCE_NOT_INSTALLED", "error.instance.location.move_requires_install");
    }

    const source = this.resolvePaths().instancePath;
    const pathsMod = await this.paths();
    const guard = this.buildGuard(pathsMod);
    const validation = pathsMod.validateInstancePathCandidate(destinationPath, guard, {
      sourceRoot: source
    });
    if (!validation.ok || !validation.canonicalPath) {
      throw toUiError("INSTANCE_LOCATION_INVALID", "error.instance.location.invalid", {
        reason: validation.reason ?? "invalid"
      });
    }

    this.moving = true;
    const startedAt = Date.now();
    try {
      const moveMod = await this.move();
      this.deps.onProgress?.({
        phase: "PREPARING",
        operation: "move",
        indeterminate: true,
        elapsedMs: 0
      });

      const settings = this.deps.getSettings();
      const moveResult = (await moveMod.moveInstanceTree({
        sourceRoot: source,
        destinationRoot: validation.canonicalPath,
        guard,
        commitLocationFn: async (destinationRoot: string) => {
          settings.setPersistedInstancePath(destinationRoot);
        },
        onProgress: (p: {
          copiedBytes: number;
          totalBytes: number;
          indeterminate: boolean;
          phase: string;
        }) => {
          const elapsedMs = Date.now() - startedAt;
          const indeterminate = p.indeterminate || p.totalBytes <= 0;
          this.deps.onProgress?.({
            phase:
              p.phase === "COPYING"
                ? "DOWNLOADING"
                : p.phase === "VERIFYING"
                  ? "VERIFYING"
                  : p.phase === "COMMIT_LOCATION"
                    ? "APPLYING"
                    : "APPLYING",
            operation: "move",
            indeterminate,
            elapsedMs,
            ...(p.totalBytes > 0
              ? {
                  completedBytes: p.copiedBytes,
                  totalBytes: p.totalBytes,
                  percent: Math.min(100, Math.round((p.copiedBytes / p.totalBytes) * 100)),
                  metricScope: "download" as const
                }
              : {})
          });
        }
      })) as { destinationRoot: string; sourceCleanupFailed?: boolean };
      if (moveResult.sourceCleanupFailed) {
        this.deps.onNotification?.("WARNING", "error.instance.location.source_cleanup_failed");
      }
      await this.deps.onLocationChanged?.();
      this.deps.onProgress?.({
        phase: "COMPLETED",
        operation: "move",
        indeterminate: false,
        elapsedMs: Date.now() - startedAt,
        percent: 100,
        metricScope: "download"
      });
      return this.toResultDto();
    } catch (e) {
      this.deps.onProgress?.({
        phase: "FAILED",
        operation: "move",
        indeterminate: true,
        elapsedMs: Date.now() - startedAt
      });
      throw mapMoveError(e);
    } finally {
      this.moving = false;
    }
  }

  isMoving(): boolean {
    return this.moving;
  }
}

function mapLocationPolicyError(e: unknown): ReturnType<typeof toUiError> {
  const code =
    typeof e === "object" && e !== null && "code" in e
      ? String((e as { code: unknown }).code)
      : "";
  if (code === "INSTANCE_LOCATION_NOT_EMPTY") {
    return toUiError("INSTANCE_LOCATION_NOT_EMPTY", "error.instance.location.not_empty");
  }
  if (code === "INSTANCE_ALREADY_INSTALLED") {
    return toUiError("INSTANCE_ALREADY_INSTALLED", "error.instance.location.installed_use_move");
  }
  return toUiError("INSTANCE_LOCATION_INVALID", "error.instance.location.invalid");
}

function mapMoveError(e: unknown): ReturnType<typeof toUiError> {
  if (typeof e === "object" && e !== null && "code" in e && "messageKey" in e) {
    return e as ReturnType<typeof toUiError>;
  }
  const code =
    typeof e === "object" && e !== null && "code" in e
      ? String((e as { code: unknown }).code)
      : "";
  if (code === "INSUFFICIENT_DISK_SPACE") {
    return toUiError("INSUFFICIENT_DISK_SPACE", "error.instance.location.insufficient_space");
  }
  if (code === "UNSAFE_PATH") {
    return toUiError("INSTANCE_LOCATION_INVALID", "error.instance.location.nonempty_destination");
  }
  if (code === "INSTANCE_MOVE_FAILED") {
    const details =
      typeof e === "object" && e !== null && "details" in e
        ? (e as { details?: Record<string, unknown> }).details
        : undefined;
    if (details?.preservedSource === true) {
      if (details.phase === "VERIFYING") {
        return toUiError(
          "INSTANCE_MOVE_VERIFY_FAILED",
          "error.instance.location.move_verify_failed"
        );
      }
      const nativeCode = details.nativeCode;
      if (
        nativeCode === "EEXIST" ||
        (typeof nativeCode === "string" && nativeCode.startsWith("ERR_FS_CP"))
      ) {
        return toUiError("INSTANCE_MOVE_COPY_FAILED", "error.instance.location.move_copy_failed");
      }
      if (details.phase === "COMMIT_LOCATION") {
        return toUiError("INSTANCE_MOVE_PRESERVED", "error.instance.location.move_preserved");
      }
      return toUiError("INSTANCE_MOVE_PRESERVED", "error.instance.location.move_preserved");
    }
  }
  return toUiError("INSTANCE_MOVE_FAILED", "error.instance.location.move_failed");
}
