/**
 * Development-only fake Play backend.
 * Never spawns Java/Minecraft, never touches real GameProcessLock / 0.5B.
 */

import { toUiError } from "../../shared/validate.js";
import type { PlayStatusDto } from "../../shared/contract.js";
import type { PlayBackendPort, PlayBackendStartResult } from "./play-types.js";
import { normalizePlayStatus } from "./play-dto.js";
import {
  clearFakePlayStore,
  defaultFakePlayState,
  loadFakePlayStore,
  saveFakePlayStore,
  type FakePlayFixtureId,
  type FakePlayStoreFile
} from "./fake-play-store.js";

export interface FakePlayBackendOptions {
  readonly persistDir?: string;
  readonly launchingDelayMs?: number;
  readonly nonzeroExitDelayMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, ms));
}

export class FakePlayBackend implements PlayBackendPort {
  private state: FakePlayStoreFile;
  private readonly persistDir: string | null;
  private readonly sleep: (ms: number) => Promise<void>;
  launchingDelayMs: number;
  nonzeroExitDelayMs: number;
  currentFixture: FakePlayFixtureId = "SUCCESS";
  lastAppliedFixture: FakePlayFixtureId | null = null;
  realPlayInvocations = 0;
  spawnInvocations = 0;
  gameLockTouches = 0;
  private exitResolver: ((code: number | null) => void) | null = null;
  private completion: Promise<{ exitCode: number | null }> | null = null;

  constructor(opts?: FakePlayBackendOptions) {
    this.persistDir = opts?.persistDir ?? null;
    this.sleep = opts?.sleep ?? defaultSleep;
    this.launchingDelayMs = opts?.launchingDelayMs ?? 400;
    this.nonzeroExitDelayMs = opts?.nonzeroExitDelayMs ?? 600;
    if (this.persistDir) {
      this.state = loadFakePlayStore(this.persistDir);
      this.currentFixture = this.state.fixture;
    } else {
      this.state = defaultFakePlayState("SUCCESS");
    }
  }

  applyFixture(fixture: FakePlayFixtureId): void {
    this.currentFixture = fixture;
    this.lastAppliedFixture = fixture;
    this.exitResolver = null;
    this.completion = null;
    if (fixture === "GAME_ALREADY_RUNNING") {
      this.state = {
        schemaVersion: 1,
        fixture,
        state: "RUNNING",
        minecraftUsername: "JoueurDemo",
        accountId: "mc:fake-demo",
        lastExitCode: null,
        fakeSessionActive: true
      };
    } else if (fixture === "MALFORMED_LOCK") {
      this.state = {
        schemaVersion: 1,
        fixture,
        state: "RECOVERY_REQUIRED",
        minecraftUsername: null,
        accountId: null,
        lastExitCode: null,
        fakeSessionActive: false
      };
    } else {
      this.state = {
        schemaVersion: 1,
        fixture,
        state: "UNAVAILABLE",
        minecraftUsername: null,
        accountId: null,
        lastExitCode: null,
        fakeSessionActive: false
      };
    }
    this.persist();
  }

  reset(): void {
    if (this.persistDir) clearFakePlayStore(this.persistDir);
    this.state = defaultFakePlayState("SUCCESS");
    this.currentFixture = "SUCCESS";
    this.lastAppliedFixture = null;
    this.exitResolver = null;
    this.completion = null;
  }

  private persist(): void {
    if (!this.persistDir) return;
    saveFakePlayStore(this.persistDir, this.state);
  }

  private toDto(): PlayStatusDto {
    const raw: Record<string, unknown> = { state: this.state.state };
    if (this.state.minecraftUsername) raw.minecraftUsername = this.state.minecraftUsername;
    if (this.state.accountId) raw.accountId = this.state.accountId;
    if (this.state.state === "LAUNCHING") raw.phaseKey = "play.phase.launching";
    if (this.state.state === "RUNNING") {
      raw.phaseKey = "play.phase.running";
      raw.messageKey = "play.message.running";
    }
    if (this.state.state === "RECOVERY_REQUIRED") {
      raw.messageKey = "error.play.malformed_lock";
    }
    if (this.state.lastExitCode !== null && this.state.lastExitCode !== undefined) {
      raw.lastExitCode = this.state.lastExitCode;
    }
    return normalizePlayStatus(raw);
  }

  async getStatus(): Promise<PlayStatusDto> {
    if (this.persistDir) {
      this.state = loadFakePlayStore(this.persistDir);
      this.currentFixture = this.state.fixture;
    }
    return this.toDto();
  }

  async restoreObservedSession(): Promise<PlayStatusDto> {
    if (this.persistDir) this.state = loadFakePlayStore(this.persistDir);
    if (this.state.fakeSessionActive && this.state.state === "RUNNING") {
      this.completion = new Promise((resolve) => {
        this.exitResolver = (code) => resolve({ exitCode: code });
      });
      return this.toDto();
    }
    return this.toDto();
  }

  /**
   * Fake-only: end simulated Minecraft session.
   * NOT a real process kill.
   */
  simulateExit(exitCode = 0): PlayStatusDto {
    if (this.state.state !== "RUNNING" && this.state.state !== "LAUNCHING") {
      throw toUiError("INTERNAL_ERROR", "error.play.generic");
    }
    this.state = {
      schemaVersion: 1,
      fixture: this.state.fixture,
      state: "EXITED",
      minecraftUsername: this.state.minecraftUsername,
      accountId: this.state.accountId,
      lastExitCode: exitCode,
      fakeSessionActive: false
    };
    this.persist();
    const resolver = this.exitResolver;
    this.exitResolver = null;
    resolver?.(exitCode);
    if (exitCode !== 0) {
      return normalizePlayStatus({
        state: "ERROR",
        lastExitCode: exitCode,
        messageKey: "error.play.nonzero_exit",
        error: { code: "NONZERO_EXIT", messageKey: "error.play.nonzero_exit" }
      });
    }
    return normalizePlayStatus({
      state: "EXITED",
      lastExitCode: 0,
      messageKey: "play.message.exited"
    });
  }

  async start(opts: {
    accountId: string;
    onStatus?: (s: PlayStatusDto) => void;
  }): Promise<PlayBackendStartResult> {
    if (this.currentFixture === "MALFORMED_LOCK" || this.state.state === "RECOVERY_REQUIRED") {
      throw toUiError("MALFORMED_LOCK", "error.play.malformed_lock");
    }
    if (
      this.currentFixture === "GAME_ALREADY_RUNNING" ||
      this.state.state === "RUNNING" ||
      this.state.fakeSessionActive
    ) {
      throw toUiError("GAME_ALREADY_RUNNING", "error.play.already_running");
    }
    if (this.currentFixture === "ACCOUNT_MISMATCH") {
      throw toUiError("AUTH_ACCOUNT_MISMATCH", "error.play.account_mismatch");
    }
    if (this.currentFixture === "JAVA_UNAVAILABLE") {
      throw toUiError("JAVA_UNAVAILABLE", "error.play.java_unavailable");
    }
    if (this.currentFixture === "SPAWN_FAILURE") {
      this.state = { ...this.state, state: "LAUNCHING" };
      opts.onStatus?.(
        normalizePlayStatus({ state: "LAUNCHING", phaseKey: "play.phase.launching" })
      );
      await this.sleep(this.launchingDelayMs);
      throw toUiError("SPAWN_FAILURE", "error.play.spawn_failure");
    }
    if (this.currentFixture === "BIND_FAILURE") {
      this.state = { ...this.state, state: "LAUNCHING" };
      opts.onStatus?.(
        normalizePlayStatus({ state: "LAUNCHING", phaseKey: "play.phase.launching" })
      );
      await this.sleep(this.launchingDelayMs);
      throw toUiError("BIND_FAILURE", "error.play.bind_failure");
    }
    if (this.currentFixture === "GENERIC_ERROR") {
      throw toUiError("INTERNAL_ERROR", "error.play.generic");
    }

    this.state = {
      schemaVersion: 1,
      fixture: this.currentFixture,
      state: "LAUNCHING",
      minecraftUsername: "JoueurDemo",
      accountId: opts.accountId,
      lastExitCode: null,
      fakeSessionActive: false
    };
    this.persist();
    opts.onStatus?.(this.toDto());
    await this.sleep(this.launchingDelayMs);

    this.state = {
      ...this.state,
      state: "RUNNING",
      fakeSessionActive: true
    };
    this.persist();
    const running = this.toDto();
    opts.onStatus?.(running);

    this.completion = new Promise((resolve) => {
      this.exitResolver = (code) => resolve({ exitCode: code });
    });

    if (this.currentFixture === "NONZERO_EXIT") {
      const completion = this.completion;
      void (async () => {
        await this.sleep(this.nonzeroExitDelayMs);
        this.simulateExit(1);
      })();
      return { status: running, completion };
    }

    return { status: running, completion: this.completion };
  }
}

export class EmptyPlayBackend implements PlayBackendPort {
  async getStatus(): Promise<PlayStatusDto> {
    return normalizePlayStatus({
      state: "UNAVAILABLE",
      messageKey: "play.message.unavailable"
    });
  }
  async start(): Promise<PlayBackendStartResult> {
    throw toUiError("INTERNAL_ERROR", "error.play.generic");
  }
}
