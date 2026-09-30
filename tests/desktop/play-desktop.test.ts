/**
 * 0.6D desktop play — eligibility, fake harness, lifecycle, errors.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  FakePlayBackend,
  PlayDesktopService,
  assertFakePlayFixturePayload,
  clearFakePlayStore,
  loadFakePlayStore,
  mapPlayError,
  normalizePlayStatus,
  resolvePlayEligibility,
  shouldUseFakePlayBackend,
  FAKE_PLAY_FIXTURES
} from "../../desktop/main/play/index.js";
import type { LauncherReadiness } from "../../desktop/shared/contract.js";
import { IpcChannels } from "../../desktop/shared/contract.js";

function eligCtx(opts: {
  readiness?: LauncherReadiness;
  installBusy?: boolean;
  account?: { accountId: string; minecraftUsername: string } | null;
}) {
  return {
    getInstallReadiness: () => opts.readiness ?? ("READY" as LauncherReadiness),
    isInstallMutationBusy: () => opts.installBusy ?? false,
    getAuthenticatedAccount: () =>
      opts.account === undefined
        ? { accountId: "mc:demo", minecraftUsername: "JoueurDemo" }
        : opts.account
  };
}

describe("0.6D play fake harness gating", () => {
  it("packaged + fake env → never fake", () => {
    assert.equal(shouldUseFakePlayBackend({ isPackaged: true, fakeEnv: "1" }), false);
  });
  it("unpackaged without env → real backend", () => {
    assert.equal(shouldUseFakePlayBackend({ isPackaged: false, fakeEnv: undefined }), false);
  });
  it("unpackaged + env=1 → fake", () => {
    assert.equal(shouldUseFakePlayBackend({ isPackaged: false, fakeEnv: "1" }), true);
  });
});

describe("0.6D eligibility", () => {
  it("READY + AUTHENTICATED + idle → Play allowed", () => {
    assert.equal(resolvePlayEligibility(eligCtx({})).eligible, true);
  });
  it("READY + signed out → Play blocked", () => {
    assert.equal(resolvePlayEligibility(eligCtx({ account: null })).eligible, false);
  });
  it("NOT_INSTALLED → Play blocked", () => {
    assert.equal(
      resolvePlayEligibility(eligCtx({ readiness: "NOT_INSTALLED" })).eligible,
      false
    );
  });
  it("UPDATE_AVAILABLE → Play blocked", () => {
    assert.equal(
      resolvePlayEligibility(eligCtx({ readiness: "UPDATE_AVAILABLE" })).eligible,
      false
    );
  });
  it("REPAIR_REQUIRED → Play blocked", () => {
    assert.equal(
      resolvePlayEligibility(eligCtx({ readiness: "REPAIR_REQUIRED" })).eligible,
      false
    );
  });
  it("RECOVERY_REQUIRED → Play blocked", () => {
    assert.equal(
      resolvePlayEligibility(eligCtx({ readiness: "RECOVERY_REQUIRED" })).eligible,
      false
    );
  });
  it("install mutation active → Play blocked", () => {
    assert.equal(resolvePlayEligibility(eligCtx({ installBusy: true })).eligible, false);
  });
});

describe("0.6D fixture enum", () => {
  it("fixture enum strict + default SUCCESS path", () => {
    for (const id of FAKE_PLAY_FIXTURES) {
      assert.ok(id.length > 0);
    }
    assert.throws(() => assertFakePlayFixturePayload({ fixture: "NOPE" }));
    assert.throws(() => assertFakePlayFixturePayload({ path: "C:\\\\x" }));
    assert.equal(assertFakePlayFixturePayload({ fixture: "SUCCESS" }), "SUCCESS");
  });
});

describe("0.6D fake SUCCESS lifecycle", () => {
  it("SUCCESS → LAUNCHING → RUNNING; start returns without waiting exit", async () => {
    const backend = new FakePlayBackend({ launchingDelayMs: 20 });
    backend.applyFixture("SUCCESS");
    const statuses: string[] = [];
    const svc = new PlayDesktopService(backend, eligCtx({}), {
      onStatus(s) {
        statuses.push(s.state);
      }
    });
    await svc.getStatus();
    assert.equal(svc.getLastStatus().state, "READY");
    const started = await svc.start();
    assert.equal(started.state, "RUNNING");
    assert.ok(statuses.includes("LAUNCHING"));
    assert.ok(statuses.includes("RUNNING"));
    assert.equal(backend.spawnInvocations, 0);
    assert.equal(backend.realPlayInvocations, 0);
    assert.equal(backend.gameLockTouches, 0);
  });

  it("duplicate Play → one start only / busy", async () => {
    const backend = new FakePlayBackend({ launchingDelayMs: 80 });
    backend.applyFixture("SUCCESS");
    const svc = new PlayDesktopService(backend, eligCtx({}));
    await svc.getStatus();
    const first = svc.start();
    await assert.rejects(() => svc.start(), (e: unknown) => {
      assert.equal(mapPlayError(e).code, "GAME_ALREADY_RUNNING");
      return true;
    });
    const running = await first;
    assert.equal(running.state, "RUNNING");
  });

  it("fake exit 0 → eligibility READY again", async () => {
    const backend = new FakePlayBackend({ launchingDelayMs: 10 });
    backend.applyFixture("SUCCESS");
    const svc = new PlayDesktopService(backend, eligCtx({}));
    await svc.getStatus();
    await svc.start();
    assert.equal(svc.getLastStatus().state, "RUNNING");
    svc.simulateFakeExit(0);
    await new Promise((r) => setTimeout(r, 30));
    const st = await svc.getStatus();
    assert.equal(st.state, "READY");
  });
});

describe("0.6D fake error fixtures", () => {
  it("ACCOUNT_MISMATCH → correct error", async () => {
    const backend = new FakePlayBackend({ launchingDelayMs: 0 });
    backend.applyFixture("ACCOUNT_MISMATCH");
    const svc = new PlayDesktopService(backend, eligCtx({}));
    await svc.getStatus();
    await assert.rejects(() => svc.start(), (e: unknown) => {
      assert.equal(mapPlayError(e).code, "AUTH_ACCOUNT_MISMATCH");
      return true;
    });
  });

  it("JAVA_UNAVAILABLE → correct error", async () => {
    const backend = new FakePlayBackend({ launchingDelayMs: 0 });
    backend.applyFixture("JAVA_UNAVAILABLE");
    const svc = new PlayDesktopService(backend, eligCtx({}));
    await svc.getStatus();
    await assert.rejects(() => svc.start(), (e: unknown) => {
      assert.equal(mapPlayError(e).code, "JAVA_UNAVAILABLE");
      return true;
    });
  });

  it("SPAWN_FAILURE → correct error; gate clears", async () => {
    const backend = new FakePlayBackend({ launchingDelayMs: 5 });
    backend.applyFixture("SPAWN_FAILURE");
    const svc = new PlayDesktopService(backend, eligCtx({}));
    await svc.getStatus();
    await assert.rejects(() => svc.start(), (e: unknown) => {
      assert.equal(mapPlayError(e).code, "SPAWN_FAILURE");
      return true;
    });
    assert.equal(svc.isPlayBusy(), false);
  });

  it("BIND_FAILURE → fail closed", async () => {
    const backend = new FakePlayBackend({ launchingDelayMs: 5 });
    backend.applyFixture("BIND_FAILURE");
    const svc = new PlayDesktopService(backend, eligCtx({}));
    await svc.getStatus();
    await assert.rejects(() => svc.start(), (e: unknown) => {
      assert.equal(mapPlayError(e).code, "BIND_FAILURE");
      return true;
    });
  });

  it("MALFORMED_LOCK → fail closed", async () => {
    const backend = new FakePlayBackend({ launchingDelayMs: 0 });
    backend.applyFixture("MALFORMED_LOCK");
    const svc = new PlayDesktopService(backend, eligCtx({}));
    const st = await svc.getStatus();
    assert.equal(st.state, "RECOVERY_REQUIRED");
    await assert.rejects(() => svc.start());
  });

  it("GAME_ALREADY_RUNNING → blocked", async () => {
    const backend = new FakePlayBackend({ launchingDelayMs: 0 });
    backend.applyFixture("GAME_ALREADY_RUNNING");
    const svc = new PlayDesktopService(backend, eligCtx({}));
    const st = await svc.getStatus();
    assert.equal(st.state, "RUNNING");
    await assert.rejects(() => svc.start(), (e: unknown) => {
      assert.equal(mapPlayError(e).code, "GAME_ALREADY_RUNNING");
      return true;
    });
  });

  it("NONZERO_EXIT → safe error after running", async () => {
    const backend = new FakePlayBackend({
      launchingDelayMs: 5,
      nonzeroExitDelayMs: 30
    });
    backend.applyFixture("NONZERO_EXIT");
    const statuses: string[] = [];
    const svc = new PlayDesktopService(backend, eligCtx({}), {
      onStatus(s) {
        statuses.push(s.state);
      }
    });
    await svc.getStatus();
    await svc.start();
    await new Promise((r) => setTimeout(r, 80));
    assert.ok(statuses.includes("RUNNING"));
    assert.ok(statuses.includes("ERROR") || svc.getLastStatus().state === "ERROR" || svc.getLastStatus().state === "READY" || svc.getLastStatus().state === "UNAVAILABLE");
  });
});

describe("0.6D cold restore fake", () => {
  it("persists RUNNING across backend recreation; simulate exit works", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-fake-play-"));
    try {
      const a = new FakePlayBackend({ persistDir: dir, launchingDelayMs: 5 });
      a.applyFixture("SUCCESS");
      const svc = new PlayDesktopService(a, eligCtx({}));
      await svc.getStatus();
      await svc.start();
      assert.equal((await a.getStatus()).state, "RUNNING");

      const b = new FakePlayBackend({ persistDir: dir, launchingDelayMs: 0 });
      const restored = await b.restoreObservedSession!();
      assert.equal(restored.state, "RUNNING");
      const svc2 = new PlayDesktopService(b, eligCtx({}));
      await svc2.restoreOnBootstrap();
      assert.equal(svc2.getLastStatus().state, "RUNNING");
      svc2.simulateFakeExit(0);
      await new Promise((r) => setTimeout(r, 20));
      assert.notEqual((await svc2.getStatus()).state, "RUNNING");

      clearFakePlayStore(dir);
      const c = new FakePlayBackend({ persistDir: dir });
      assert.equal(c.currentFixture, "SUCCESS");
      assert.equal((await c.getStatus()).state, "UNAVAILABLE");
      assert.ok(!dir.includes("launcher-data"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("0.6D play vs install race (eligibility)", () => {
  it("Play blocked while install busy", async () => {
    const backend = new FakePlayBackend({ launchingDelayMs: 0 });
    backend.applyFixture("SUCCESS");
    const svc = new PlayDesktopService(backend, eligCtx({ installBusy: true }));
    await assert.rejects(() => svc.start(), (e: unknown) => {
      assert.equal(mapPlayError(e).code, "INSTANCE_BUSY");
      return true;
    });
  });
});

describe("0.6D DTO safety", () => {
  it("no raw path/token in play DTO; unknown error safe", () => {
    const dto = normalizePlayStatus({
      state: "ERROR",
      messageKey: "error.play.generic",
      error: { code: "INTERNAL_ERROR", messageKey: "error.play.generic" }
    });
    assert.ok(!JSON.stringify(dto).includes("accessToken"));
    const unk = mapPlayError(new Error("java.exe C:\\\\Users\\\\secret --accessToken=abc"));
    assert.equal(unk.code, "INTERNAL_ERROR");
    assert.ok(!JSON.stringify(unk).includes("secret"));
    assert.ok(!JSON.stringify(unk).includes("accessToken"));
  });

  it("IPC channels include explicit play surface only", () => {
    assert.ok(Object.values(IpcChannels).includes("sc:play:getStatus"));
    assert.ok(Object.values(IpcChannels).includes("sc:play:start"));
    assert.ok(!Object.values(IpcChannels).includes("sc:play:command"));
  });
});

describe("0.6D persistence load", () => {
  it("loadFakePlayStore isolated schema", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-fake-play2-"));
    try {
      const b = new FakePlayBackend({ persistDir: dir });
      b.applyFixture("GAME_ALREADY_RUNNING");
      const loaded = loadFakePlayStore(dir);
      assert.equal(loaded.state, "RUNNING");
      assert.equal(loaded.fakeSessionActive, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
