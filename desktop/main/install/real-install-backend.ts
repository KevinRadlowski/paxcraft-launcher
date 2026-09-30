/**
 * Real frozen 0.5A adapter for Electron Main.
 * Loads compiled dist application orchestrator — does not rewrite 0.5A.
 */

import path from "node:path";
import { pathToFileURL } from "node:url";
import type { InstallProgressDto } from "../../shared/contract.js";
import type { InstallBackendPort, InstallStatusSnapshot } from "./install-types.js";
import { recoverabilityForReadiness } from "./install-dto.js";
import { mapInstallError } from "./install-errors.js";
import { createInstallProgressAggregator } from "./install-progress-aggregator.js";
import {
  createLiveRuntimeSources,
  loadDefaultProductBase
} from "../shared/live-runtime-sources.js";
import { PRODUCT_DEFAULT_CHANNEL } from "../../shared/product.js";

export interface RealInstallBackendOptions {
  /** Isolated launcher data dir (NOT fake harness). */
  dataDir: string;
  /** Dynamic resolver — supports PACK-10.1G configurable instance location. */
  getInstancePath: () => string;
  getLocationUnavailable?: () => boolean;
  runtimePath?: string;
  distRoot: string;
  channel?: "dev" | "beta" | "stable";
  productBase?: string;
  trustedKeysPath?: string;
  skipRuntimePrep?: boolean;
}

type OrchestratorModule = {
  inspectInstanceStatus: (
    req: Record<string, unknown>,
    deps: Record<string, unknown>
  ) => Promise<{
    status: string;
    channel: string;
    installedVersion: string | null;
    latestVersion: string | null;
    findings: string[];
    orphanTransaction: boolean;
  }>;
  installInstance: (
    req: Record<string, unknown>,
    deps: Record<string, unknown>
  ) => Promise<unknown>;
  updateInstance: (
    req: Record<string, unknown>,
    deps: Record<string, unknown>
  ) => Promise<unknown>;
  repairInstance: (
    req: Record<string, unknown>,
    deps: Record<string, unknown>
  ) => Promise<unknown>;
  uninstallInstance: (
    req: Record<string, unknown>,
    deps: Record<string, unknown>
  ) => Promise<unknown>;
  ProgressEmitter: new () => {
    on(listener: (event: { type: string; data: Record<string, unknown> }) => void): () => void;
  };
  FetchHttpClient: new () => unknown;
  FetchByteSource: new () => unknown;
  FileAntiRollbackStore: new (p: string) => {
    load(): Promise<unknown>;
  };
  loadTrustedKeyStoreFromFile: (p: string) => unknown;
  antiRollbackStatePath: (dataDir: string) => string;
  liveRuntimeSources?: () => unknown;
};

async function loadOrchestrator(distRoot: string): Promise<OrchestratorModule> {
  const appHref = pathToFileURL(path.join(distRoot, "application", "index.js")).href;
  const httpHref = pathToFileURL(path.join(distRoot, "distribution", "http", "index.js")).href;
  const trustHref = pathToFileURL(path.join(distRoot, "core", "trust", "index.js")).href;
  const stateHref = pathToFileURL(path.join(distRoot, "instance", "state", "index.js")).href;
  const pathsHref = pathToFileURL(path.join(distRoot, "instance", "paths", "index.js")).href;
  const eventsHref = pathToFileURL(path.join(distRoot, "instance", "events", "index.js")).href;
  const downloadHref = pathToFileURL(path.join(distRoot, "download", "engine", "sources.js")).href;

  const [app, http, trust, state, paths, events, download] = await Promise.all([
    import(appHref),
    import(httpHref),
    import(trustHref),
    import(stateHref),
    import(pathsHref),
    import(eventsHref),
    import(downloadHref)
  ]);

  return {
    inspectInstanceStatus: app.inspectInstanceStatus,
    installInstance: app.installInstance,
    updateInstance: app.updateInstance,
    repairInstance: app.repairInstance,
    uninstallInstance: app.uninstallInstance,
    ProgressEmitter: events.ProgressEmitter,
    FetchHttpClient: http.FetchHttpClient,
    FetchByteSource: download.FetchByteSource,
    FileAntiRollbackStore: state.FileAntiRollbackStore,
    loadTrustedKeyStoreFromFile: trust.loadTrustedKeyStoreFromFile,
    antiRollbackStatePath: paths.antiRollbackStatePath
  } as OrchestratorModule;
}

function mapStatusCode(code: string): InstallStatusSnapshot["readiness"] {
  switch (code) {
    case "NOT_INSTALLED":
    case "READY":
    case "UPDATE_AVAILABLE":
    case "REPAIR_REQUIRED":
    case "BUSY":
    case "INCOMPATIBLE_STATE":
    case "RECOVERY_REQUIRED":
      return code;
    case "LOCATION_UNAVAILABLE":
      return "LOCATION_UNAVAILABLE";
    default:
      return "UNKNOWN";
  }
}

export async function createRealInstallBackend(
  opts: RealInstallBackendOptions
): Promise<InstallBackendPort> {
  const mod = await loadOrchestrator(opts.distRoot);
  /**
   * Production coherence (0.6D.1):
   * - skipRuntimePrep=true → pack-only (dev safety when keys absent)
   * - skipRuntimePrep=false → liveRuntimeSources + FetchByteSource so
   *   prepareMinecraftRuntime downloads Mojang/Fabric during install.
   * Play then dry-runs plan against existing runtime files.
   */
  const skipRuntime = opts.skipRuntimePrep === true;
  const channel = opts.channel ?? PRODUCT_DEFAULT_CHANNEL;
  const productBase =
    opts.productBase ?? (await loadDefaultProductBase(opts.distRoot));
  const trustedKeysPath =
    opts.trustedKeysPath ?? path.join(opts.distRoot, "..", "config", "trusted-keys.json");

  async function buildDeps(
    onProgress?: (p: InstallProgressDto) => void,
    progressOpts?: { fallbackOperation?: InstallProgressDto["operation"] },
  ) {
    const trust = mod.loadTrustedKeyStoreFromFile(trustedKeysPath);
    const antiRollbackStore = new mod.FileAntiRollbackStore(
      mod.antiRollbackStatePath(opts.dataDir)
    );
    const antiRollbackState = await antiRollbackStore.load();
    const emitter = new mod.ProgressEmitter();
    let aggregator: ReturnType<typeof createInstallProgressAggregator> | null = null;
    if (onProgress) {
      aggregator = createInstallProgressAggregator(onProgress, {
        fallbackOperation: progressOpts?.fallbackOperation ?? "install",
        log: (entry) => {
          console.info(JSON.stringify(entry));
        },
      });
      emitter.on((event) => {
        aggregator!.handleEvent(event);
      });
    }
    const http = new mod.FetchHttpClient() as {
      request(o: { url: string; maxBytes: number }): Promise<{
        body: Buffer | Uint8Array;
        finalUrl: string;
        headers: Record<string, string | undefined>;
      }>;
    };
    const deps: Record<string, unknown> = {
      http,
      trust,
      artefactSource: new mod.FetchByteSource(),
      antiRollbackStore,
      antiRollbackState,
      emitter
    };
    if (!skipRuntime) {
      deps.runtimeSources = await createLiveRuntimeSources(opts.distRoot, http);
      deps.runtimeByteSource = new mod.FetchByteSource();
    }
    return { deps, aggregator };
  }

  function baseReq(operation: string): Record<string, unknown> {
    const runtimePath = opts.runtimePath ?? path.join(opts.dataDir, "runtime");
    const req: Record<string, unknown> = {
      operation,
      channel,
      instancePath: opts.getInstancePath(),
      productBase,
      runtimePath
    };
    if (skipRuntime) req.skipRuntimePrep = true;
    return req;
  }

  return {
    async getStatus(o?: {
      onProgress?: (p: InstallProgressDto) => void;
    }): Promise<InstallStatusSnapshot> {
      if (opts.getLocationUnavailable?.()) {
        return {
          readiness: "LOCATION_UNAVAILABLE",
          installedVersion: null,
          latestVersion: null,
          channel,
          recoverability: "NONE",
          messageKey: "install.message.location_unavailable"
        };
      }
      try {
        const { deps, aggregator } = await buildDeps(o?.onProgress, {
          fallbackOperation: "status",
        });
        const report = await mod.inspectInstanceStatus(baseReq("status"), deps);
        aggregator?.flush();
        const readiness = mapStatusCode(report.status);
        const snap: InstallStatusSnapshot = {
          readiness,
          installedVersion: report.installedVersion,
          latestVersion: report.latestVersion,
          channel: report.channel,
          recoverability: recoverabilityForReadiness(readiness),
          findings: report.findings
        };
        if (readiness === "RECOVERY_REQUIRED") {
          snap.messageKey = "install.message.recovery_required";
        } else if (readiness === "INCOMPATIBLE_STATE") {
          snap.messageKey = "install.message.incompatible";
        }
        return snap;
      } catch (e) {
        throw mapInstallError(e);
      }
    },

    async install(o: { onProgress?: (p: InstallProgressDto) => void }): Promise<void> {
      const { deps, aggregator } = await buildDeps(o.onProgress, { fallbackOperation: "install" });
      try {
        await mod.installInstance(baseReq("install"), deps);
      } catch (e) {
        throw mapInstallError(e);
      } finally {
        aggregator?.flush();
      }
    },

    async update(o: { onProgress?: (p: InstallProgressDto) => void }): Promise<void> {
      const { deps, aggregator } = await buildDeps(o.onProgress, { fallbackOperation: "update" });
      try {
        await mod.updateInstance(baseReq("update"), deps);
      } catch (e) {
        throw mapInstallError(e);
      } finally {
        aggregator?.flush();
      }
    },

    async repair(o: { onProgress?: (p: InstallProgressDto) => void }): Promise<void> {
      const { deps, aggregator } = await buildDeps(o.onProgress, { fallbackOperation: "repair" });
      try {
        await mod.repairInstance(baseReq("repair"), deps);
      } catch (e) {
        throw mapInstallError(e);
      } finally {
        aggregator?.flush();
      }
    },

    async uninstall(o: {
      mode: import("../../shared/contract.js").UninstallMode;
      onProgress?: (p: InstallProgressDto) => void;
    }): Promise<void> {
      const { deps, aggregator } = await buildDeps(o.onProgress, { fallbackOperation: "uninstall" });
      try {
        await mod.uninstallInstance(
          { ...baseReq("uninstall"), mode: o.mode, launcherDataRoot: opts.dataDir },
          deps
        );
      } catch (e) {
        throw mapInstallError(e);
      } finally {
        aggregator?.flush();
      }
    }
  };
}
