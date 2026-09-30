import type { PlayLifecycleState, PlayStatusDto, UiError } from "../../shared/contract.js";
import type { LauncherReadiness } from "../../shared/contract.js";

export type PlayBackendStartResult = {
  /** When start resolves, game is bound RUNNING (or fake equivalent). */
  status: PlayStatusDto;
  /** Resolves when fake/real game session ends. */
  completion: Promise<{ exitCode: number | null }>;
};

export interface PlayBackendPort {
  getStatus(): Promise<PlayStatusDto>;
  /**
   * Start play. Must resolve once RUNNING is safely established (spawn+bind),
   * without waiting for Minecraft exit — completion tracks exit.
   */
  start(opts: {
    accountId: string;
    onStatus?: (s: PlayStatusDto) => void;
  }): Promise<PlayBackendStartResult>;
  /** Observational cold restore of ACTIVE lock / fake session — not auth restore. */
  restoreObservedSession?(): Promise<PlayStatusDto>;
}

export type PlayEventSink = {
  onStatus(status: PlayStatusDto): void;
  onNotification?(level: "INFO" | "SUCCESS" | "WARNING" | "ERROR", messageKey: string): void;
};

/** Context injected from Main for eligibility (install + auth). */
export type PlayEligibilityContext = {
  getInstallReadiness(): LauncherReadiness;
  isInstallMutationBusy(): boolean;
  getAuthenticatedAccount(): { accountId: string; minecraftUsername: string } | null;
  /** Optional refresh after game exit. */
  refreshInstallStatus?(): Promise<void>;
};

export type { PlayLifecycleState, PlayStatusDto, UiError };
