import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkAntiRollback,
  createEmptyAntiRollbackState,
  withAcceptedRelease,
  FileAntiRollbackStore
} from "../src/instance/state/index.js";
import { ErrorCode, LauncherError } from "../src/core/errors/index.js";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

describe("anti-rollback", () => {
  it("allows first sequence", () => {
    const state = createEmptyAntiRollbackState();
    checkAntiRollback(state, {
      channel: "dev",
      releaseSequence: 3,
      packVersion: "0.1.2",
      releasePath: "releases/0.1.2/release.json",
      releaseSha256: "a".repeat(64)
    });
  });

  it("rejects lower sequence (rollback)", () => {
    let state = createEmptyAntiRollbackState();
    state = withAcceptedRelease(state, {
      channel: "dev",
      releaseSequence: 3,
      packVersion: "0.1.2",
      releasePath: "releases/0.1.2/release.json",
      releaseSha256: "a".repeat(64)
    });
    assert.throws(
      () =>
        checkAntiRollback(state, {
          channel: "dev",
          releaseSequence: 2,
          packVersion: "0.1.1",
          releasePath: "releases/0.1.1/release.json",
          releaseSha256: "b".repeat(64)
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.ROLLBACK_DETECTED
    );
  });

  it("accepts equal sequence only with same identity", () => {
    let state = createEmptyAntiRollbackState();
    const identity = {
      channel: "dev" as const,
      releaseSequence: 3,
      packVersion: "0.1.2",
      releasePath: "releases/0.1.2/release.json",
      releaseSha256: "a".repeat(64)
    };
    state = withAcceptedRelease(state, identity);
    checkAntiRollback(state, identity);
    assert.throws(
      () =>
        checkAntiRollback(state, {
          ...identity,
          releaseSha256: "c".repeat(64)
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.ROLLBACK_DETECTED
    );
  });

  it("persists state atomically", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sc-arb-"));
    const file = path.join(dir, "anti-rollback.json");
    const store = new FileAntiRollbackStore(file);
    let state = await store.load();
    state = withAcceptedRelease(state, {
      channel: "dev",
      releaseSequence: 3,
      packVersion: "0.1.2",
      releasePath: "releases/0.1.2/release.json",
      releaseSha256: "a".repeat(64)
    });
    await store.saveAtomic(state);
    const reloaded = await store.load();
    assert.equal(reloaded.channels.dev?.highestAcceptedReleaseSequence, 3);
    const raw = await readFile(file, "utf8");
    assert.ok(raw.includes("highestAcceptedReleaseSequence"));
  });
});
