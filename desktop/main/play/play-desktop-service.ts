/**
 * PlayDesktopService — process-local gate around fake/real play backends.
 * GameProcessLock remains owned by frozen 0.5B (real path).
 */

import type { PlayStatusDto } from "../../shared/contract.js";
import { toUiError } from "../../shared/validate.js";
import { normalizePlayStatus } from "./play-dto.js";
import { mapPlayError } from "./play-errors.js";
import type {
  PlayBackendPort,
  PlayEligibilityContext,
  PlayEventSink
} from "./play-types.js";

export function resolvePlayEligibility(ctx: PlayEligibilityContext): {
  eligible: boolean;
  reasonCode?: string;
  messageKey?: string;
} {
  if (ctx.isInstallMutationBusy()) {
    return { eligible: false, reasonCode: "INSTANCE_BUSY", messageKey: "error.install.busy" };
  }
  const readiness = ctx.getInstallReadiness();
  if (readiness === "NOT_INSTALLED") {
    return {
      eligible: false,
      reasonCode: "PLAY_INSTALL_REQUIRED",
      messageKey: "error.play_install_required"
    };
  }
  if (readiness === "UPDATE_AVAILABLE") {
    return {
      eligible: false,
      reasonCode: "PLAY_UPDATE_REQUIRED",
      messageKey: "error.play_update_required"
    };
  }
  if (readiness === "REPAIR_REQUIRED") {
    return {
      eligible: false,
      reasonCode: "PLAY_REPAIR_REQUIRED",
      messageKey: "error.play_repair_required"
    };
  }
  if (readiness === "RECOVERY_REQUIRED" || readiness === "INCOMPATIBLE_STATE") {
    return {
      eligible: false,
      reasonCode: "RECOVERY_REQUIRED",
      messageKey: "error.install.recovery"
    };
  }
  if (readiness !== "READY") {
    return {
      eligible: false,
      reasonCode: "PLAY_UNAVAILABLE",
      messageKey: "play.message.unavailable"
    };
  }
  if (!ctx.getAuthenticatedAccount()) {
    return {
      eligible: false,
      reasonCode: "AUTH_LOGIN_REQUIRED",
      messageKey: "error.auth_login_required"
    };
  }
  return { eligible: true };
}

export class PlayDesktopService {
  private busy = false;
  private lastStatus: PlayStatusDto = normalizePlayStatus({ state: "UNAVAILABLE" });
  private watchingCompletion = false;

  constructor(
    private readonly backend: PlayBackendPort,
    private readonly eligibility: PlayEligibilityContext,
    private readonly sink?: PlayEventSink
  ) {}

  getLastStatus(): PlayStatusDto {
    return this.lastStatus;
  }

  isPlayBusy(): boolean {
    return (
      this.busy ||
      this.lastStatus.state === "LAUNCHING" ||
      this.lastStatus.state === "RUNNING"
    );
  }

  private emit(status: PlayStatusDto): void {
    this.lastStatus = status;
    this.sink?.onStatus(status);
  }

  async restoreOnBootstrap(): Promise<PlayStatusDto> {
    if (this.backend.restoreObservedSession) {
      const restored = await this.backend.restoreObservedSession();
      this.emit(restored);
      if (restored.state === "RUNNING") {
        // Fake path wires completion via restore; real path may poll externally.
      }
      return restored;
    }
    return this.getStatus();
  }

  async getStatus(): Promise<PlayStatusDto> {
    const backendStatus = await this.backend.getStatus();
    if (
      backendStatus.state === "RUNNING" ||
      backendStatus.state === "LAUNCHING" ||
      backendStatus.state === "RECOVERY_REQUIRED"
    ) {
      this.emit(backendStatus);
      return backendStatus;
    }
    if (backendStatus.state === "ERROR" && backendStatus.error) {
      this.emit(backendStatus);
      return backendStatus;
    }

    const elig = resolvePlayEligibility(this.eligibility);
    if (elig.eligible) {
      const account = this.eligibility.getAuthenticatedAccount()!;
      const dto = normalizePlayStatus({
        state: "READY",
        accountId: account.accountId,
        minecraftUsername: account.minecraftUsername,
        messageKey: "play.message.ready"
      });
      this.emit(dto);
      return dto;
    }
    const dto = normalizePlayStatus({
      state: "UNAVAILABLE",
      messageKey: elig.messageKey ?? "play.message.unavailable"
    });
    this.emit(dto);
    return dto;
  }

  async start(): Promise<PlayStatusDto> {
    if (this.busy || this.lastStatus.state === "LAUNCHING" || this.lastStatus.state === "RUNNING") {
      throw toUiError("GAME_ALREADY_RUNNING", "error.play.already_running");
    }
    const elig = resolvePlayEligibility(this.eligibility);
    if (!elig.eligible) {
      throw toUiError(
        elig.reasonCode ?? "PLAY_UNAVAILABLE",
        elig.messageKey ?? "play.message.unavailable"
      );
    }
    const account = this.eligibility.getAuthenticatedAccount();
    if (!account) {
      throw toUiError("AUTH_LOGIN_REQUIRED", "error.auth_login_required");
    }

    this.busy = true;
    this.emit(
      normalizePlayStatus({
        state: "LAUNCHING",
        accountId: account.accountId,
        minecraftUsername: account.minecraftUsername,
        phaseKey: "play.phase.launching",
        messageKey: "play.message.launching"
      })
    );

    try {
      const result = await this.backend.start({
        accountId: account.accountId,
        onStatus: (s) => this.emit(s)
      });
      this.emit(result.status);
      this.busy = false;
      void this.watchCompletion(result.completion);
      return result.status;
    } catch (e) {
      this.busy = false;
      const err = mapPlayError(e);
      const dto = normalizePlayStatus({
        state: err.code === "MALFORMED_LOCK" ? "RECOVERY_REQUIRED" : "ERROR",
        error: err,
        messageKey: err.messageKey
      });
      this.emit(dto);
      this.sink?.onNotification?.("ERROR", err.messageKey);
      throw err;
    }
  }

  private async watchCompletion(
    completion: Promise<{ exitCode: number | null }>
  ): Promise<void> {
    if (this.watchingCompletion) return;
    this.watchingCompletion = true;
    try {
      const exit = await completion;
      const code = exit.exitCode;
      if (code === 0 || code === null) {
        this.emit(
          normalizePlayStatus({
            state: "EXITED",
            lastExitCode: code,
            messageKey: "play.message.exited"
          })
        );
      } else {
        this.emit(
          normalizePlayStatus({
            state: "ERROR",
            lastExitCode: code,
            messageKey: "error.play.nonzero_exit",
            error: { code: "NONZERO_EXIT", messageKey: "error.play.nonzero_exit" }
          })
        );
        this.sink?.onNotification?.("WARNING", "error.play.nonzero_exit");
      }
      try {
        await this.eligibility.refreshInstallStatus?.();
      } catch {
        // best-effort
      }
      await this.getStatus();
    } finally {
      this.watchingCompletion = false;
    }
  }

  /**
   * Fake harness only — simulate Minecraft exit (not a process kill API).
   */
  simulateFakeExit(exitCode = 0): PlayStatusDto {
    const backend = this.backend as { simulateExit?: (code?: number) => PlayStatusDto };
    if (typeof backend.simulateExit !== "function") {
      throw toUiError("INTERNAL_ERROR", "error.play.generic");
    }
    const dto = backend.simulateExit(exitCode);
    this.emit(dto);
    void (async () => {
      try {
        await this.eligibility.refreshInstallStatus?.();
      } catch {
        // ignore
      }
      await this.getStatus();
    })();
    return dto;
  }
}
