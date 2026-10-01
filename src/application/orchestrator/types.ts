import type { HttpClient } from "../../distribution/http/index.js";
import type { MapTrustedKeyStore } from "../../core/trust/index.js";
import type { AntiRollbackState, FileAntiRollbackStore } from "../../instance/state/index.js";
import type { ByteSource } from "../../download/engine/types.js";
import type { RuntimeMetadataSources } from "../../minecraft/runtime/plan.js";
import type { PlatformInfo } from "../../platform/index.js";
import type { ProgressEmitter } from "../../instance/events/index.js";
import type { ReleaseChannelName } from "../../core/channel/index.js";

export type LauncherOperation = "status" | "install" | "update" | "repair" | "uninstall";

export type InstanceStatusCode =
  | "NOT_INSTALLED"
  | "READY"
  | "UPDATE_AVAILABLE"
  | "REPAIR_REQUIRED"
  | "BUSY"
  | "INCOMPATIBLE_STATE"
  | "RECOVERY_REQUIRED";

export type OperationPhase =
  | "RESOLVING"
  | "INSPECTING"
  | "PLANNING"
  | "DOWNLOADING"
  | "STAGING"
  | "APPLYING"
  | "PREPARING_RUNTIME"
  | "VERIFYING"
  | "COMMITTING"
  | "CLEANUP"
  | "DONE";

export type OperationOutcome = "NOOP" | "SUCCESS";

export type TransactionPhase =
  | "PLANNED"
  | "ACQUIRING"
  | "STAGED"
  | "APPLYING"
  | "VERIFYING"
  | "COMMITTING"
  | "COMMITTED"
  | "FAILED"
  | "ABANDONED";

export interface OrchestratorRequestBase {
  channel: ReleaseChannelName;
  instancePath: string;
  /** Isolated Minecraft/Fabric runtime root (defaults beside launcher data). */
  runtimePath?: string;
  productBase?: string;
  signal?: AbortSignal;
  forceStaleLock?: boolean;
  /** Skip Minecraft/Fabric runtime preparation (tests that only cover pack layer). */
  skipRuntimePrep?: boolean;
}

export interface StatusRequest extends OrchestratorRequestBase {
  operation: "status";
}

export interface InstallRequest extends OrchestratorRequestBase {
  operation: "install";
}

export interface UpdateRequest extends OrchestratorRequestBase {
  operation: "update";
}

export interface RepairRequest extends OrchestratorRequestBase {
  operation: "repair";
}

export type UninstallMode = "SAFE" | "COMPLETE";

export interface UninstallRequest extends OrchestratorRequestBase {
  operation: "uninstall";
  mode?: UninstallMode;
  /** Launcher-data root for COMPLETE path validation (desktop-provided). */
  launcherDataRoot?: string;
}

export type OrchestratorRequest =
  | StatusRequest
  | InstallRequest
  | UpdateRequest
  | RepairRequest
  | UninstallRequest;

export interface OrchestratorDependencies {
  http: HttpClient;
  trust: MapTrustedKeyStore;
  artefactSource: ByteSource;
  antiRollbackStore: FileAntiRollbackStore;
  antiRollbackState: AntiRollbackState;
  /** Required unless skipRuntimePrep. */
  runtimeSources?: RuntimeMetadataSources;
  /** Required for runtime downloads unless skipRuntimePrep. */
  runtimeByteSource?: ByteSource;
  platform?: PlatformInfo;
  emitter?: ProgressEmitter;
  /** Injectable id factory for tests. */
  createOperationId?: () => string;
  /**
   * PACK-PAX-05.1 — opaque harness permit (tests only via paxNetworkTestHooks).
   * Never set by CLI / packaged desktop.
   */
  networkHarness?: import("../../product/paxNetworkConfig.js").NetworkHarnessPermit;
  /** Runtime trust context for network policy. Omission ⇒ packaged-production. */
  networkRuntime?: import("../../product/paxNetworkConfig.js").PaxNetworkRuntimeContext;
  /** Test/injection hooks — never used in production CLI. */
  hooks?: {
    /** Called while lock is held, during runtime prep (before downloads if skipped). */
    duringRuntimePrep?: () => Promise<void>;
    /** After filesystem apply, before final audit (state still uncommitted). */
    afterFilesystemApply?: () => Promise<void>;
    /** Immediately before final audit; may mutate disk to force VERIFY failure. */
    beforeFinalAudit?: () => Promise<void>;
  };
}

export interface OperationProgress {
  operationId: string;
  operation: LauncherOperation;
  phase: OperationPhase;
  completedItems?: number;
  totalItems?: number;
  completedBytes?: number;
  totalBytes?: number;
  /** Logical artefact id — never a filesystem secret path. */
  currentItem?: string;
}

export interface OperationResult {
  operationId: string;
  operation: Exclude<LauncherOperation, "status">;
  outcome: OperationOutcome;
  releaseVersion: string;
  releaseSequence: number;
  changedFiles: number;
  downloadedFiles: number;
  downloadedBytes: number;
}

export interface InstanceStatusReport {
  operationId: string;
  operation: "status";
  status: InstanceStatusCode;
  channel: string;
  installedVersion: string | null;
  installedSequence: number | null;
  latestVersion: string | null;
  latestSequence: number | null;
  /** Safe finding codes only (no paths with user home by default). */
  findings: string[];
  lockPresent: boolean;
  orphanTransaction: boolean;
}
