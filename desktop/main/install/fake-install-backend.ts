/**
 * Development-only fake install backend.
 * Never touches real Minecraft instance / CDN / 0.5A transaction files.
 */

import { toUiError } from "../../shared/validate.js";
import type { InstallProgressDto } from "../../shared/contract.js";
import type { InstallBackendPort, InstallStatusSnapshot } from "./install-types.js";
import { recoverabilityForReadiness } from "./install-dto.js";
import { normalizeInstallProgress } from "./install-progress.js";
import {
  clearFakeInstallStore,
  defaultFakeInstallState,
  fixtureToState,
  loadFakeInstallStore,
  saveFakeInstallStore,
  type FakeInstallFixtureId,
  type FakeInstallStoreFile
} from "./fake-install-store.js";

export interface FakeInstallBackendOptions {
  readonly persistDir?: string;
  /** Controllable delay between progress steps (tests set 0). */
  readonly stepDelayMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const SUCCESS_PHASES = [
  "PREPARING",
  "RESOLVING_RELEASE",
  "PLANNING",
  "DOWNLOADING",
  "APPLYING",
  "VERIFYING",
  "COMMITTING",
  "COMPLETED"
] as const;

function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, ms));
}

export class FakeInstallBackend implements InstallBackendPort {
  private state: FakeInstallStoreFile;
  private readonly persistDir: string | null;
  private readonly sleep: (ms: number) => Promise<void>;
  stepDelayMs: number;
  currentFixture: FakeInstallFixtureId;
  lastAppliedFixture: FakeInstallFixtureId | null = null;
  /** Observability: prove no real network. */
  networkInvocations = 0;
  realBackendInvocations = 0;
  private mutationInFlight = false;

  constructor(opts?: FakeInstallBackendOptions) {
    this.persistDir = opts?.persistDir ?? null;
    this.sleep = opts?.sleep ?? defaultSleep;
    this.stepDelayMs = opts?.stepDelayMs ?? 40;
    if (this.persistDir) {
      this.state = loadFakeInstallStore(this.persistDir);
      this.currentFixture = this.state.fixture;
    } else {
      this.state = defaultFakeInstallState("NOT_INSTALLED");
      this.currentFixture = "NOT_INSTALLED";
    }
  }

  applyFixture(fixture: FakeInstallFixtureId): void {
    this.currentFixture = fixture;
    this.lastAppliedFixture = fixture;
    const mapped = fixtureToState(fixture);
    this.state = {
      schemaVersion: 1,
      fixture,
      readiness: mapped.readiness,
      installedVersion: mapped.installedVersion,
      latestVersion: mapped.latestVersion
    };
    this.persist();
  }

  reset(): void {
    if (this.persistDir) clearFakeInstallStore(this.persistDir);
    this.state = defaultFakeInstallState("NOT_INSTALLED");
    this.currentFixture = "NOT_INSTALLED";
    this.lastAppliedFixture = null;
    this.mutationInFlight = false;
  }

  private persist(): void {
    if (!this.persistDir) return;
    saveFakeInstallStore(this.persistDir, this.state);
  }

  async getStatus(opts?: {
    onProgress?: (p: import("../../shared/contract.js").InstallProgressDto) => void;
  }): Promise<InstallStatusSnapshot> {
    if (this.persistDir) {
      this.state = loadFakeInstallStore(this.persistDir);
      this.currentFixture = this.state.fixture;
    }
    if (opts?.onProgress) {
      for (const phase of ["RESOLVING", "INSPECTING", "DONE"] as const) {
        opts.onProgress(
          normalizeInstallProgress({ phase, operation: "status" }, "status")
        );
      }
    }
    const snap: InstallStatusSnapshot = {
      readiness: this.state.readiness,
      installedVersion: this.state.installedVersion,
      latestVersion: this.state.latestVersion,
      channel: "dev",
      recoverability: recoverabilityForReadiness(this.state.readiness)
    };
    if (this.state.readiness === "RECOVERY_REQUIRED") {
      snap.messageKey = "install.message.recovery_required";
    }
    return snap;
  }

  private async emitPhases(
    operation: "install" | "update" | "repair" | "uninstall",
    onProgress?: (p: InstallProgressDto) => void,
    opts?: { failAt?: (typeof SUCCESS_PHASES)[number]; failCode?: string; failKey?: string }
  ): Promise<void> {
    const totalFiles = 4;
    let completed = 0;
    for (const phase of SUCCESS_PHASES) {
      if (phase === "DOWNLOADING" || phase === "APPLYING" || phase === "VERIFYING") {
        completed = Math.min(totalFiles, completed + 1);
      }
      if (phase === "COMPLETED") completed = totalFiles;
      const progress = normalizeInstallProgress(
        {
          phase,
          operation,
          completedItems: completed,
          totalItems: totalFiles,
          currentItemLabel: phase === "DOWNLOADING" ? "pack-core" : undefined
        },
        operation
      );
      onProgress?.(progress);
      await this.sleep(this.stepDelayMs);
      if (opts?.failAt && phase === opts.failAt) {
        throw toUiError(opts.failCode ?? "INTERNAL_ERROR", opts.failKey ?? "error.install.generic");
      }
    }
  }

  private assertMutable(): void {
    if (this.state.readiness === "RECOVERY_REQUIRED") {
      throw toUiError("RECOVERY_REQUIRED", "error.install.recovery");
    }
    if (this.state.readiness === "BUSY" || this.mutationInFlight) {
      throw toUiError("INSTANCE_BUSY", "error.install.busy");
    }
  }

  async install(opts: { onProgress?: (p: InstallProgressDto) => void }): Promise<void> {
    this.assertMutable();
    if (this.currentFixture === "NETWORK_ERROR") {
      this.mutationInFlight = true;
      try {
        await this.emitPhases("install", opts.onProgress, {
          failAt: "DOWNLOADING",
          failCode: "NETWORK_ERROR",
          failKey: "error.install.network"
        });
      } catch (e) {
        throw e;
      } finally {
        this.mutationInFlight = false;
      }
    }
    if (this.currentFixture === "INTEGRITY_ERROR") {
      this.mutationInFlight = true;
      try {
        await this.emitPhases("install", opts.onProgress, {
          failAt: "VERIFYING",
          failCode: "INTEGRITY_ERROR",
          failKey: "error.install.integrity"
        });
      } catch (e) {
        this.state = {
          ...this.state,
          readiness: "REPAIR_REQUIRED",
          installedVersion: this.state.installedVersion ?? "1.0.0-fake"
        };
        this.persist();
        throw e;
      } finally {
        this.mutationInFlight = false;
      }
    }
    if (this.currentFixture === "GENERIC_ERROR") {
      throw toUiError("INTERNAL_ERROR", "error.install.generic");
    }
    this.mutationInFlight = true;
    try {
      await this.emitPhases("install", opts.onProgress);
      this.state = {
        schemaVersion: 1,
        fixture: "READY",
        readiness: "READY",
        installedVersion: "1.0.0-fake",
        latestVersion: "1.0.0-fake"
      };
      this.currentFixture = "READY";
      this.persist();
    } finally {
      this.mutationInFlight = false;
    }
  }

  async update(opts: { onProgress?: (p: InstallProgressDto) => void }): Promise<void> {
    this.assertMutable();
    if (this.currentFixture === "NETWORK_ERROR") {
      this.mutationInFlight = true;
      try {
        await this.emitPhases("update", opts.onProgress, {
          failAt: "DOWNLOADING",
          failCode: "NETWORK_ERROR",
          failKey: "error.install.network"
        });
      } catch (e) {
        throw e;
      } finally {
        this.mutationInFlight = false;
      }
    }
    if (this.currentFixture === "INTEGRITY_ERROR") {
      this.mutationInFlight = true;
      try {
        await this.emitPhases("update", opts.onProgress, {
          failAt: "VERIFYING",
          failCode: "INTEGRITY_ERROR",
          failKey: "error.install.integrity"
        });
      } catch (e) {
        this.state = {
          ...this.state,
          readiness: "UPDATE_AVAILABLE",
          installedVersion: "1.0.0-fake",
          latestVersion: "1.1.0-fake"
        };
        this.persist();
        throw e;
      } finally {
        this.mutationInFlight = false;
      }
    }
    this.mutationInFlight = true;
    try {
      await this.emitPhases("update", opts.onProgress);
      this.state = {
        schemaVersion: 1,
        fixture: "READY",
        readiness: "READY",
        installedVersion: "1.1.0-fake",
        latestVersion: "1.1.0-fake"
      };
      this.currentFixture = "READY";
      this.persist();
    } finally {
      this.mutationInFlight = false;
    }
  }

  async uninstall(opts: {
    mode: import("../../shared/contract.js").UninstallMode;
    onProgress?: (p: InstallProgressDto) => void;
  }): Promise<void> {
    if (opts.mode === "SAFE" && this.state.readiness === "NOT_INSTALLED") {
      return;
    }
    this.mutationInFlight = true;
    try {
      await this.emitPhases("uninstall", opts.onProgress);
      this.state = {
        schemaVersion: 1,
        fixture: "NOT_INSTALLED",
        readiness: "NOT_INSTALLED",
        installedVersion: null,
        latestVersion: "1.1.0-fake"
      };
      this.currentFixture = "NOT_INSTALLED";
      this.persist();
    } finally {
      this.mutationInFlight = false;
    }
  }

  async repair(opts: { onProgress?: (p: InstallProgressDto) => void }): Promise<void> {
    this.assertMutable();
    if (this.currentFixture === "INTEGRITY_ERROR") {
      this.mutationInFlight = true;
      try {
        await this.emitPhases("repair", opts.onProgress, {
          failAt: "VERIFYING",
          failCode: "INTEGRITY_ERROR",
          failKey: "error.install.integrity"
        });
      } catch (e) {
        this.state = {
          ...this.state,
          readiness: "REPAIR_REQUIRED"
        };
        this.persist();
        throw e;
      } finally {
        this.mutationInFlight = false;
      }
    }
    this.mutationInFlight = true;
    try {
      await this.emitPhases("repair", opts.onProgress);
      this.state = {
        schemaVersion: 1,
        fixture: "READY",
        readiness: "READY",
        installedVersion: this.state.installedVersion ?? "1.0.0-fake",
        latestVersion: this.state.latestVersion ?? "1.0.0-fake"
      };
      this.currentFixture = "READY";
      this.persist();
    } finally {
      this.mutationInFlight = false;
    }
  }
}

/** Backend that always returns UNKNOWN — used when real 0.5A cannot load. */
export class EmptyInstallBackend implements InstallBackendPort {
  async getStatus(_opts?: {
    onProgress?: (p: import("../../shared/contract.js").InstallProgressDto) => void;
  }): Promise<InstallStatusSnapshot> {
    return {
      readiness: "UNKNOWN",
      installedVersion: null,
      latestVersion: null,
      channel: "dev",
      recoverability: "NONE",
      messageKey: "install.message.status_unknown"
    };
  }
  async install(): Promise<void> {
    throw toUiError("INTERNAL_ERROR", "error.install.generic");
  }
  async update(): Promise<void> {
    throw toUiError("INTERNAL_ERROR", "error.install.generic");
  }
  async repair(): Promise<void> {
    throw toUiError("INTERNAL_ERROR", "error.install.generic");
  }
  async uninstall(_opts: {
    mode: import("../../shared/contract.js").UninstallMode;
  }): Promise<void> {
    throw toUiError("INTERNAL_ERROR", "error.install.generic");
  }
}
