/**
 * Desktop install adapter types (0.6C).
 * Backed by frozen 0.5A semantics — no invented backend states.
 */

import type {
  InstallActiveOperation,
  InstallProgressDto,
  InstallRecoverability,
  LauncherReadiness,
  UiError,
  UninstallMode
} from "../../shared/contract.js";

/** Evidence-based snapshot from backend (fake or real 0.5A). */
export interface InstallStatusSnapshot {
  readiness: LauncherReadiness;
  installedVersion: string | null;
  latestVersion: string | null;
  channel: string;
  recoverability: InstallRecoverability;
  messageKey?: string;
  findings?: readonly string[];
}

export type InstallMutation = "install" | "update" | "repair" | "uninstall";

export interface InstallProgressSink {
  onProgress(progress: InstallProgressDto): void;
}

export interface InstallBackendPort {
  getStatus(opts?: { onProgress?: (p: InstallProgressDto) => void }): Promise<InstallStatusSnapshot>;
  install(opts: { onProgress?: (p: InstallProgressDto) => void }): Promise<void>;
  update(opts: { onProgress?: (p: InstallProgressDto) => void }): Promise<void>;
  repair(opts: { onProgress?: (p: InstallProgressDto) => void }): Promise<void>;
  uninstall(opts: { mode: UninstallMode; onProgress?: (p: InstallProgressDto) => void }): Promise<void>;
}

export type InstallEventSink = {
  onStatus(status: import("../../shared/contract.js").LauncherStatusDto): void;
  onProgress(progress: InstallProgressDto): void;
  onNotification?(level: "INFO" | "SUCCESS" | "WARNING" | "ERROR", messageKey: string): void;
};

export type { InstallActiveOperation, InstallProgressDto, UiError };
