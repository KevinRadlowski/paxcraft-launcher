/**
 * Builds authoritative PlayRequest + PlayDependencies for frozen startGame().
 * Desktop coordinates only — no alternate launch path.
 */

import path from "node:path";
import { pathToFileURL } from "node:url";
import { createLiveRuntimeSources, loadDefaultProductBase } from "../shared/live-runtime-sources.js";
import { toUiError } from "../../shared/validate.js";

export type PlayDepsModules = {
  startGame: (
    req: Record<string, unknown>,
    deps: Record<string, unknown>
  ) => Promise<{
    operationId: string;
    gamePid: number;
    accountId: string;
    minecraftUsername: string;
    minecraftUuid: string;
    packVersion: string;
    releaseSequence: number;
    startedAt: string;
    completion: Promise<{
      exitCode: number | null;
      signal: unknown;
      durationMs: number;
      kind: string;
    }>;
  }>;
  inspectInstanceStatus: (
    req: Record<string, unknown>,
    deps: Record<string, unknown>
  ) => Promise<{ status: string; installedVersion: string | null; latestVersion: string | null }>;
  PlaySessionCache: new () => unknown;
  ProgressEmitter: new () => {
    on(listener: (e: { type: string; data: Record<string, unknown> }) => void): () => void;
  };
  FetchHttpClient: new () => unknown;
  FetchByteSource: new () => unknown;
  FileAntiRollbackStore: new (p: string) => { load(): Promise<unknown> };
  antiRollbackStatePath: (dataDir: string) => string;
  loadTrustedKeyStoreFromFile: (p: string) => unknown;
  defaultRuntimeRoot: (dataDir?: string) => string;
  NodeMinecraftProcessRunner: new () => unknown;
  SystemClock: new () => { nowMs(): number };
  FileAccountRegistry: new (dataDir: string) => unknown;
  createPlatformSecureRefreshTokenStore: (dataDir: string) => {
    kind: string;
    available: boolean;
    probe?: () => Promise<boolean>;
  };
  SecureBackedAuthTokenStore: new (secure: unknown, opts?: { persistRefresh: boolean }) => unknown;
  resolveLauncherAuthConfig: (opts?: { clientId?: string; env?: NodeJS.ProcessEnv }) => unknown;
  createOAuthConfigFromLauncherAuth: (cfg: unknown, redirectUri: string) => unknown;
  FetchAuthHttpTransport: new () => unknown;
  DEFAULT_PRODUCT_BASE: string;
};

export async function loadPlayDepsModules(distRoot: string): Promise<PlayDepsModules> {
  const playHref = pathToFileURL(path.join(distRoot, "application", "play", "index.js")).href;
  const appHref = pathToFileURL(path.join(distRoot, "application", "index.js")).href;
  const httpHref = pathToFileURL(path.join(distRoot, "distribution", "http", "index.js")).href;
  const trustHref = pathToFileURL(path.join(distRoot, "core", "trust", "index.js")).href;
  const stateHref = pathToFileURL(path.join(distRoot, "instance", "state", "index.js")).href;
  const pathsHref = pathToFileURL(path.join(distRoot, "instance", "paths", "index.js")).href;
  const eventsHref = pathToFileURL(path.join(distRoot, "instance", "events", "index.js")).href;
  const downloadHref = pathToFileURL(path.join(distRoot, "download", "engine", "sources.js")).href;
  const launchHref = pathToFileURL(path.join(distRoot, "launch", "process", "runner.js")).href;
  const authHref = pathToFileURL(path.join(distRoot, "auth", "index.js")).href;
  const urlsHref = pathToFileURL(path.join(distRoot, "distribution", "urls", "index.js")).href;

  const [play, app, http, trust, state, paths, events, download, launch, auth, urls] =
    await Promise.all([
      import(playHref),
      import(appHref),
      import(httpHref),
      import(trustHref),
      import(stateHref),
      import(pathsHref),
      import(eventsHref),
      import(downloadHref),
      import(launchHref),
      import(authHref),
      import(urlsHref)
    ]);

  return {
    startGame: play.startGame,
    inspectInstanceStatus: app.inspectInstanceStatus,
    PlaySessionCache: play.PlaySessionCache,
    ProgressEmitter: events.ProgressEmitter,
    FetchHttpClient: http.FetchHttpClient,
    FetchByteSource: download.FetchByteSource,
    FileAntiRollbackStore: state.FileAntiRollbackStore,
    antiRollbackStatePath: paths.antiRollbackStatePath,
    loadTrustedKeyStoreFromFile: trust.loadTrustedKeyStoreFromFile,
    defaultRuntimeRoot: paths.defaultRuntimeRoot,
    NodeMinecraftProcessRunner: launch.NodeMinecraftProcessRunner,
    SystemClock: auth.SystemClock,
    FileAccountRegistry: auth.FileAccountRegistry,
    createPlatformSecureRefreshTokenStore: auth.createPlatformSecureRefreshTokenStore,
    SecureBackedAuthTokenStore: auth.SecureBackedAuthTokenStore,
    resolveLauncherAuthConfig: auth.resolveLauncherAuthConfig,
    createOAuthConfigFromLauncherAuth: auth.createOAuthConfigFromLauncherAuth,
    FetchAuthHttpTransport: auth.FetchAuthHttpTransport,
    DEFAULT_PRODUCT_BASE: urls.DEFAULT_PRODUCT_BASE
  };
}

export interface BuildPlayContextOptions {
  distRoot: string;
  dataDir: string;
  instancePath: string;
  runtimePath?: string;
  channel: "dev" | "beta" | "stable";
  productBase?: string;
  trustedKeysPath?: string;
  memoryMiB?: number;
  /** Dynamic memory for next launch — preferred over static memoryMiB. */
  getMemoryMiB?: () => number | undefined;
  /** Injected for tests — must implement start(). */
  runner?: unknown;
  /** Injected startGame for tests. */
  startGameOverride?: PlayDepsModules["startGame"];
  /** Shared session cache across plays in-process. */
  sessionCache?: unknown;
  onPlayPhase?: (phase: string) => void;
}

export interface BuiltPlayContext {
  mods: PlayDepsModules;
  productBase: string;
  trustedKeysPath: string;
  sessionCache: unknown;
  buildRequest(accountId: string): Record<string, unknown>;
  buildDependencies(): Promise<Record<string, unknown>>;
  assertAuthoritativeReady(): Promise<void>;
  startGame: PlayDepsModules["startGame"];
}

/**
 * Fail closed if trusted keys missing — no unsigned / placeholder trust.
 * Prefer an explicit override from Desktop resource resolver (packaged: resources/config).
 * Legacy fallback: distRoot/../config (unpackaged monorepo layout only).
 */
export function resolveTrustedKeysPath(distRoot: string, override?: string): string {
  return override ?? path.join(distRoot, "..", "config", "trusted-keys.json");
}

export async function buildPlayContext(opts: BuildPlayContextOptions): Promise<BuiltPlayContext> {
  const mods = await loadPlayDepsModules(opts.distRoot);
  const trustedKeysPath = resolveTrustedKeysPath(opts.distRoot, opts.trustedKeysPath);
  const fs = await import("node:fs");
  if (!fs.existsSync(trustedKeysPath)) {
    throw toUiError("TRUST_ERROR", "error.install.trust");
  }

  const loadedBase =
    opts.productBase ?? (await loadDefaultProductBase(opts.distRoot));
  if (!loadedBase) {
    throw toUiError("DISTRIBUTION_NOT_CONFIGURED", "error.network");
  }
  // Refuse historical SweetCraft CDN even if somehow injected.
  try {
    const u = new URL(loadedBase);
    const host = u.hostname.toLowerCase();
    if (
      host === "cdn.xnosweet.fr" ||
      host === "www.xnosweet.fr" ||
      host === "xnosweet.fr" ||
      host === "xbase.fr" ||
      host === "www.xbase.fr" ||
      host === "sweetcraft.datho.st"
    ) {
      throw toUiError("HISTORICAL_DESTINATION_BLOCKED", "error.network");
    }
  } catch (e) {
    if (e && typeof e === "object" && "code" in e) throw e;
    throw toUiError("DISTRIBUTION_NOT_CONFIGURED", "error.network");
  }
  const productBase = loadedBase;

  const sessionCache = opts.sessionCache ?? new mods.PlaySessionCache();
  const startGame = opts.startGameOverride ?? mods.startGame;

  async function buildOrchestratorSlice() {
    const trust = mods.loadTrustedKeyStoreFromFile(trustedKeysPath);
    const antiRollbackStore = new mods.FileAntiRollbackStore(
      mods.antiRollbackStatePath(opts.dataDir)
    );
    const antiRollbackState = await antiRollbackStore.load();
    const http = new mods.FetchHttpClient() as {
      request(o: { url: string; maxBytes: number }): Promise<{
        body: Buffer | Uint8Array;
        finalUrl: string;
        headers: Record<string, string | undefined>;
      }>;
    };
    const runtimeSources = await createLiveRuntimeSources(opts.distRoot, http);
    return {
      http,
      trust,
      antiRollbackStore,
      antiRollbackState,
      artefactSource: new mods.FetchByteSource(),
      runtimeSources,
      runtimeByteSource: new mods.FetchByteSource()
    };
  }

  return {
    mods,
    productBase,
    trustedKeysPath,
    sessionCache,
    startGame,
    buildRequest(accountId: string) {
      const req: Record<string, unknown> = {
        channel: opts.channel,
        instancePath: opts.instancePath,
        accountId,
        productBase
      };
      const runtimePath = opts.runtimePath ?? mods.defaultRuntimeRoot(opts.dataDir);
      req.runtimePath = runtimePath;
      if (typeof opts.getMemoryMiB === "function") {
        const dynamic = opts.getMemoryMiB();
        if (typeof dynamic === "number" && Number.isFinite(dynamic)) {
          req.memoryMiB = Math.floor(dynamic);
        }
      } else if (typeof opts.memoryMiB === "number" && Number.isFinite(opts.memoryMiB)) {
        // 0.3B sanitizer clamps; desktop only forwards settings value.
        req.memoryMiB = Math.floor(opts.memoryMiB);
      }
      // Never forward extraJvmArgs / java path from renderer.
      return req;
    },
    async buildDependencies() {
      const slice = await buildOrchestratorSlice();
      const clock = new mods.SystemClock();
      const accounts = new mods.FileAccountRegistry(opts.dataDir);
      const secure = mods.createPlatformSecureRefreshTokenStore(opts.dataDir);
      if (
        secure.kind === "windows-dpapi" &&
        typeof secure.probe === "function"
      ) {
        await secure.probe();
      }
      const store = new mods.SecureBackedAuthTokenStore(secure, {
        persistRefresh: secure.available
      });
      const launcherAuth = mods.resolveLauncherAuthConfig({ env: process.env });
      const config = mods.createOAuthConfigFromLauncherAuth(
        launcherAuth,
        "http://127.0.0.1/play-unused/"
      );
      const emitter = new mods.ProgressEmitter();
      if (opts.onPlayPhase) {
        emitter.on((e) => {
          if (e.type === "PLAY_PROGRESS" && typeof e.data["phase"] === "string") {
            opts.onPlayPhase!(e.data["phase"]);
          }
        });
      }
      const runner = opts.runner ?? new mods.NodeMinecraftProcessRunner();
      const skipSystemJava = process.env.SWEETCRAFT_JAVA_SKIP_SYSTEM === "1";
      return {
        http: slice.http,
        trust: slice.trust,
        antiRollbackStore: slice.antiRollbackStore,
        antiRollbackState: slice.antiRollbackState,
        artefactSource: slice.artefactSource,
        runtimeSources: slice.runtimeSources,
        runtimeByteSource: slice.runtimeByteSource,
        emitter,
        auth: {
          config,
          transport: new mods.FetchAuthHttpTransport(),
          clock,
          store,
          accounts
        },
        accounts,
        sessionCache,
        runner,
        allowManagedJavaProvision: true,
        ...(skipSystemJava ? { skipSystemJava: true } : {})
      };
    },
    async assertAuthoritativeReady() {
      const slice = await buildOrchestratorSlice();
      const report = await mods.inspectInstanceStatus(
        {
          operation: "status",
          channel: opts.channel,
          instancePath: opts.instancePath,
          productBase
        },
        {
          http: slice.http,
          trust: slice.trust,
          antiRollbackStore: slice.antiRollbackStore,
          antiRollbackState: slice.antiRollbackState,
          artefactSource: slice.artefactSource,
          runtimeSources: slice.runtimeSources,
          runtimeByteSource: slice.runtimeByteSource
        }
      );
      if (report.status !== "READY") {
        if (report.status === "NOT_INSTALLED") {
          throw toUiError("PLAY_INSTALL_REQUIRED", "error.play_install_required");
        }
        if (report.status === "UPDATE_AVAILABLE") {
          throw toUiError("PLAY_UPDATE_REQUIRED", "error.play_update_required");
        }
        if (report.status === "REPAIR_REQUIRED") {
          throw toUiError("PLAY_REPAIR_REQUIRED", "error.play_repair_required");
        }
        if (report.status === "BUSY") {
          throw toUiError("INSTANCE_BUSY", "error.install.busy");
        }
        if (report.status === "RECOVERY_REQUIRED" || report.status === "INCOMPATIBLE_STATE") {
          throw toUiError("RECOVERY_REQUIRED", "error.install.recovery");
        }
        throw toUiError("PLAY_UNAVAILABLE", "play.message.unavailable");
      }
    }
  };
}
