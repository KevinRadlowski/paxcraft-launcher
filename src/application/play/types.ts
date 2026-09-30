import type { ReleaseChannelName } from "../../core/channel/index.js";
import type { HttpClient } from "../../distribution/http/index.js";
import type { MapTrustedKeyStore } from "../../core/trust/index.js";
import type { FileAntiRollbackStore, AntiRollbackState } from "../../instance/state/index.js";
import type { ByteSource } from "../../download/engine/types.js";
import type { RuntimeMetadataSources } from "../../minecraft/runtime/plan.js";
import type { PlatformInfo } from "../../platform/index.js";
import type { ProgressEmitter } from "../../instance/events/index.js";
import type { AuthPipelineDeps } from "../../auth/pipeline.js";
import type { MinecraftAuthSession } from "../../auth/session.js";
import type { AccountRegistry } from "../../auth/accountsFile.js";
import type { MinecraftProcessRunner } from "../../launch/process/runner.js";
import type { DiscoveredJava } from "../../java/requirements/index.js";

export type PlayPhase =
  | "CHECKING_INSTANCE"
  | "RESOLVING_ACCOUNT"
  | "RESTORING_SESSION"
  | "REFRESHING_SESSION"
  | "CHECKING_JAVA"
  | "DOWNLOADING_JAVA"
  | "VERIFYING_JAVA"
  | "INSTALLING_JAVA"
  | "PREPARING_LAUNCH"
  | "RESERVING_GAME"
  | "STARTING_GAME"
  | "RUNNING"
  | "GAME_EXITED"
  | "CLEANUP";

export interface PlayRequest {
  channel: ReleaseChannelName;
  instancePath: string;
  accountId?: string;
  runtimePath?: string;
  productBase?: string;
  signal?: AbortSignal;
  /** Max heap MiB — routed through 0.3B sanitizer. */
  memoryMiB?: number;
  minMemoryMiB?: number;
  extraJvmArgs?: string[];
  forceStaleGameLock?: boolean;
  forceStaleInstanceLock?: boolean;
}

export interface GameExitResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  kind: "exit" | "signal" | "spawn_error";
}

export interface RunningGame {
  operationId: string;
  gamePid: number;
  accountId: string;
  minecraftUsername: string;
  minecraftUuid: string;
  packVersion: string;
  releaseSequence: number;
  startedAt: string;
  completion: Promise<GameExitResult>;
}

export interface PlayResult {
  operationId: string;
  accountId: string;
  minecraftUsername: string;
  minecraftUuid: string;
  packVersion: string;
  releaseSequence: number;
  gamePid: number;
  outcome: "STARTED" | "EXITED";
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  durationMs?: number;
}

/** In-memory Minecraft sessions — never persisted. */
export class PlaySessionCache {
  private readonly map = new Map<string, MinecraftAuthSession>();

  get(accountId: string): MinecraftAuthSession | undefined {
    return this.map.get(accountId);
  }

  set(session: MinecraftAuthSession): void {
    this.map.set(session.accountId, session);
  }

  delete(accountId: string): void {
    this.map.delete(accountId);
  }

  clear(): void {
    this.map.clear();
  }
}

export interface PlayDependencies {
  http: HttpClient;
  trust: MapTrustedKeyStore;
  antiRollbackStore: FileAntiRollbackStore;
  antiRollbackState: AntiRollbackState;
  artefactSource?: ByteSource;
  runtimeSources?: RuntimeMetadataSources;
  runtimeByteSource?: ByteSource;
  platform?: PlatformInfo;
  emitter?: ProgressEmitter;
  createOperationId?: () => string;
  /** Auth pipeline (config, transport, clock, store, accounts). */
  auth: AuthPipelineDeps;
  accounts: AccountRegistry;
  sessionCache?: PlaySessionCache;
  runner: MinecraftProcessRunner;
  /** Injected Java for tests; otherwise discovered / provisioned. */
  java?: DiscoveredJava;
  /**
   * When true, skip classpath file existence (offline E2E with mocked spawn).
   * Production CLI leaves this false.
   */
  requireClasspathFiles?: boolean;
  /** Test-only: allow launch readiness with missing runtime files. */
  allowIncompleteRuntime?: boolean;
  /** When false, never download managed Java (offline fail-closed). Default true. */
  allowManagedJavaProvision?: boolean;
  /** When true, ignore JAVA_HOME / PATH (E2E isolation). */
  skipSystemJava?: boolean;
  /** Test hooks. */
  hooks?: {
    afterGameLockReserved?: () => Promise<void>;
    beforeSpawn?: () => Promise<void>;
    afterInstanceLockAcquired?: () => Promise<void>;
  };
}
