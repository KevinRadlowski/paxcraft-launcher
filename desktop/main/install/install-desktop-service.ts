/**
 * Desktop install service — process-local operation gate + 0.5A adapter.
 * InstanceLock remains authoritative in frozen 0.5A; this gate only
 * prevents duplicate IPC mutations in the same Electron process.
 */

import type {
  InstallActiveOperation,
  InstallProgressDto,
  LauncherStatusDto
} from "../../shared/contract.js";
import { toUiError } from "../../shared/validate.js";
import { snapshotToStatusDto } from "./install-dto.js";
import { mapInstallError } from "./install-errors.js";
import type {
  InstallBackendPort,
  InstallEventSink,
  InstallMutation
} from "./install-types.js";

export class InstallDesktopService {
  private op: InstallActiveOperation = "IDLE";
  private lastStatus: LauncherStatusDto | null = null;
  private lastProgress: InstallProgressDto | undefined;

  constructor(
    private readonly backend: InstallBackendPort,
    private readonly sink?: InstallEventSink
  ) {}

  getActiveOperation(): InstallActiveOperation {
    return this.op;
  }

  isMutationBusy(): boolean {
    return (
      this.op === "INSTALLING" ||
      this.op === "UPDATING" ||
      this.op === "REPAIRING" ||
      this.op === "UNINSTALLING"
    );
  }

  private emitStatus(status: LauncherStatusDto): void {
    this.lastStatus = status;
    this.sink?.onStatus(status);
  }

  private emitProgress(progress: InstallProgressDto): void {
    this.lastProgress = progress;
    this.sink?.onProgress(progress);
  }

  private buildDto(
    snap: Awaited<ReturnType<InstallBackendPort["getStatus"]>>,
    active: InstallActiveOperation = this.op,
    progress?: InstallProgressDto
  ): LauncherStatusDto {
    return snapshotToStatusDto(snap, {
      activeOperation: active,
      ...(progress ? { progress } : {})
    });
  }

  async getStatus(): Promise<LauncherStatusDto> {
    const previous = this.op;
    const checking = !this.isMutationBusy();
    if (checking) {
      this.op = "CHECKING";
    }
    try {
      const onProgress = checking
        ? (p: InstallProgressDto) => {
            this.emitProgress(p);
            const base = this.lastStatus;
            if (base) {
              this.emitStatus({
                ...base,
                activeOperation: "CHECKING",
                progress: p
              });
            }
          }
        : undefined;
      const snap = await this.backend.getStatus(onProgress ? { onProgress } : undefined);
      const dto = this.buildDto(
        snap,
        this.isMutationBusy() ? this.op : "IDLE",
        this.isMutationBusy() ? this.lastProgress : undefined
      );
      this.emitStatus(dto);
      return dto;
    } catch (e) {
      const err = mapInstallError(e);
      const dto = snapshotToStatusDto(
        {
          readiness: "ERROR",
          installedVersion: null,
          latestVersion: null,
          channel: "dev",
          recoverability: "NONE",
          messageKey: err.messageKey
        },
        { activeOperation: this.isMutationBusy() ? this.op : "IDLE" }
      );
      this.emitStatus(dto);
      throw err;
    } finally {
      if (!this.isMutationBusy()) {
        this.op = "IDLE";
      } else {
        // Preserve mutation op; ignore interrupted CHECKING overlay.
        void previous;
      }
    }
  }

  private async runMutation(
    mutation: InstallMutation,
    active: InstallActiveOperation,
    successKey: string,
    uninstallMode?: import("../../shared/contract.js").UninstallMode
  ): Promise<LauncherStatusDto> {
    if (this.isMutationBusy() || this.op === "CHECKING") {
      throw toUiError("INSTANCE_BUSY", "error.install.busy");
    }
    this.op = active;
    this.lastProgress = undefined;
    try {
      // Immediate busy surface
      const pre = this.lastStatus;
      if (pre) {
        this.emitStatus({
          ...pre,
          readiness: "BUSY",
          activeOperation: active
        });
      } else {
        this.emitStatus(
          snapshotToStatusDto(
            {
              readiness: "BUSY",
              installedVersion: null,
              latestVersion: null,
              channel: "dev",
              recoverability: "NONE"
            },
            { activeOperation: active }
          )
        );
      }

      const onProgress = (p: InstallProgressDto) => {
        this.emitProgress(p);
        const base = this.lastStatus;
        if (base) {
          this.emitStatus({
            ...base,
            readiness: "BUSY",
            activeOperation: active,
            progress: p
          });
        }
      };

      if (mutation === "install") await this.backend.install({ onProgress });
      else if (mutation === "update") await this.backend.update({ onProgress });
      else if (mutation === "repair") await this.backend.repair({ onProgress });
      else await this.backend.uninstall({ onProgress, mode: uninstallMode ?? "SAFE" });

      this.sink?.onNotification?.("SUCCESS", successKey);

      // Authoritative refresh — never blind READY
      this.op = "IDLE";
      this.lastProgress = undefined;
      return await this.getStatus();
    } catch (e) {
      const err = mapInstallError(e);
      this.sink?.onNotification?.("ERROR", err.messageKey);
      this.op = "IDLE";
      this.lastProgress = undefined;
      try {
        await this.getStatus();
      } catch {
        // status refresh best-effort after failure
      }
      throw err;
    }
  }

  install(): Promise<LauncherStatusDto> {
    return this.runMutation("install", "INSTALLING", "install.toast.success_install");
  }

  update(): Promise<LauncherStatusDto> {
    return this.runMutation("update", "UPDATING", "install.toast.success_update");
  }

  repair(): Promise<LauncherStatusDto> {
    return this.runMutation("repair", "REPAIRING", "install.toast.success_repair");
  }

  uninstall(mode: import("../../shared/contract.js").UninstallMode = "SAFE"): Promise<LauncherStatusDto> {
    const successKey =
      mode === "COMPLETE"
        ? "install.toast.success_uninstall_complete"
        : "install.toast.success_uninstall";
    return this.runMutation("uninstall", "UNINSTALLING", successKey, mode);
  }
}
