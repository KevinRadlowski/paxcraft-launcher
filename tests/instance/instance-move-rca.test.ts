import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { access, appendFile, mkdtemp, mkdir, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { moveInstanceTree } from "../../src/instance/move/index.js";
import { buildInstancePathGuardContext } from "../../src/instance/paths/instanceLocation.js";
import { ErrorCode, LauncherError } from "../../src/core/errors/index.js";
import { INSTANCE_STATE_SCHEMA_VERSION } from "../../src/instance/state/instanceState.js";

async function seedRealisticInstance(root: string): Promise<void> {
  await mkdir(path.join(root, "launcher"), { recursive: true });
  await writeFile(
    path.join(root, "launcher", "state.json"),
    JSON.stringify({
      schemaVersion: INSTANCE_STATE_SCHEMA_VERSION,
      installedPackVersion: "0.1.3",
      installedReleaseSequence: 4,
      installedReleaseSha256: null,
      installedManifestSha256: null,
      channel: "dev",
      productBase: "https://cdn.xnosweet.fr/sweetcraft",
      files: [],
      updatedAt: new Date().toISOString()
    })
  );
  await mkdir(path.join(root, "mods"), { recursive: true });
  await mkdir(path.join(root, "config"), { recursive: true });
  await mkdir(path.join(root, "resourcepacks"), { recursive: true });
  await mkdir(path.join(root, "saves", "MyWorld"), { recursive: true });
  await mkdir(path.join(root, "logs"), { recursive: true });
  await writeFile(path.join(root, "mods", "personal.jar"), "mod");
  await writeFile(path.join(root, "saves", "MyWorld", "level.dat"), "world");
  await writeFile(path.join(root, "logs", "latest.log"), "line1\n");
  await writeFile(path.join(root, "options.txt"), "lang:fr");
}

async function guard() {
  const userData = await mkdtemp(path.join(tmpdir(), "sc-rca-ud-"));
  const launcherData = path.join(userData, "launcher-data");
  await mkdir(launcherData, { recursive: true });
  return buildInstancePathGuardContext(launcherData, userData);
}

describe("PACK-10.1G.5 migration RCA fix", () => {
  it("PASS: move into pre-existing empty destination (human E2E scenario)", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "sc-rca-empty-dest-"));
    const source = path.join(base, "source");
    const destination = path.join(base, "dest");
    await seedRealisticInstance(source);
    await mkdir(destination, { recursive: true });
    const pathGuard = await guard();
    let committed = false;

    const result = await moveInstanceTree({
      sourceRoot: source,
      destinationRoot: destination,
      guard: pathGuard,
      freeSpaceFn: async () => Number.MAX_SAFE_INTEGER,
      commitLocationFn: async () => {
        committed = true;
      }
    });

    assert.equal(result.strategy, "copy");
    assert.equal(committed, true);
    await access(path.join(destination, "launcher", "state.json"));
    await access(path.join(destination, "logs", "latest.log"));
    await assert.rejects(() => access(source));
  });

  it("PASS: move into absent destination", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "sc-rca-absent-dest-"));
    const source = path.join(base, "source");
    const destination = path.join(base, "dest");
    await seedRealisticInstance(source);
    const pathGuard = await guard();

    const result = await moveInstanceTree({
      sourceRoot: source,
      destinationRoot: destination,
      guard: pathGuard,
      freeSpaceFn: async () => Number.MAX_SAFE_INTEGER,
      commitLocationFn: async () => {}
    });

    assert.equal(result.strategy, "copy");
    await access(path.join(destination, "mods", "personal.jar"));
    await assert.rejects(() => access(source));
  });

  it("PASS: source log grows during copy (manifest verification tolerates runtime writes)", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "sc-rca-race-fix-"));
    const source = path.join(base, "source");
    const destination = path.join(base, "dest");
    await seedRealisticInstance(source);
    const logPath = path.join(source, "logs", "latest.log");
    const pathGuard = await guard();

    const result = await moveInstanceTree({
      sourceRoot: source,
      destinationRoot: destination,
      guard: pathGuard,
      freeSpaceFn: async () => Number.MAX_SAFE_INTEGER,
      copyTreeFn: async (from, to) => {
        const { cp } = await import("node:fs/promises");
        await cp(from, to, { recursive: true, force: true });
        await appendFile(logPath, "runtime write during migration\n");
      },
      commitLocationFn: async () => {}
    });

    assert.equal(result.strategy, "copy");
    await access(path.join(destination, "options.txt"));
    await assert.rejects(() => access(source));
  });

  it("rollback: pre-existing empty destination preserved after copy failure", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "sc-rca-rollback-pre-"));
    const source = path.join(base, "source");
    const destination = path.join(base, "dest");
    await seedRealisticInstance(source);
    await mkdir(destination, { recursive: true });
    const pathGuard = await guard();

    await assert.rejects(
      () =>
        moveInstanceTree({
          sourceRoot: source,
          destinationRoot: destination,
          guard: pathGuard,
          freeSpaceFn: async () => Number.MAX_SAFE_INTEGER,
          copyTreeFn: async () => {
            const err = new Error("target exists") as NodeJS.ErrnoException;
            err.code = "EEXIST";
            throw err;
          },
          commitLocationFn: async () => {}
        }),
      (e: unknown) => {
        assert.ok(e instanceof LauncherError);
        assert.equal(e.code, ErrorCode.INSTANCE_MOVE_FAILED);
        assert.equal(e.details?.preservedSource, true);
        assert.equal(e.details?.phase, "COPYING");
        assert.equal(e.details?.destinationExistedBefore, true);
        assert.equal(e.details?.destinationCreatedByMove, false);
        assert.equal(e.details?.destinationCleanup?.preservedEmptyShell, true);
        return true;
      }
    );

    assert.equal(existsSync(destination), true);
    assert.deepEqual(await readdir(destination), []);
    await access(path.join(source, "launcher", "state.json"));
  });

  it("rollback: transaction-created destination removed after copy failure", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "sc-rca-rollback-txn-"));
    const source = path.join(base, "source");
    const destination = path.join(base, "dest");
    await seedRealisticInstance(source);
    const pathGuard = await guard();

    await assert.rejects(
      () =>
        moveInstanceTree({
          sourceRoot: source,
          destinationRoot: destination,
          guard: pathGuard,
          freeSpaceFn: async () => Number.MAX_SAFE_INTEGER,
          copyTreeFn: async () => {
            throw new Error("copy interrupted");
          },
          commitLocationFn: async () => {}
        }),
      (e: unknown) => {
        assert.ok(e instanceof LauncherError);
        assert.equal(e.details?.destinationExistedBefore, false);
        assert.equal(e.details?.destinationCreatedByMove, true);
        assert.equal(e.details?.destinationCleanup?.removed, true);
        return true;
      }
    );

    assert.equal(existsSync(destination), false);
    await access(path.join(source, "options.txt"));
  });

  it("rollback: pre-existing empty destination preserved after commit failure", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "sc-rca-commit-pre-"));
    const source = path.join(base, "source");
    const destination = path.join(base, "dest");
    await seedRealisticInstance(source);
    await mkdir(destination, { recursive: true });
    const pathGuard = await guard();

    await assert.rejects(
      () =>
        moveInstanceTree({
          sourceRoot: source,
          destinationRoot: destination,
          guard: pathGuard,
          freeSpaceFn: async () => Number.MAX_SAFE_INTEGER,
          commitLocationFn: async () => {
            throw new Error("settings persist failed");
          }
        }),
      (e: unknown) => {
        assert.ok(e instanceof LauncherError);
        assert.equal(e.details?.phase, "COMMIT_LOCATION");
        assert.equal(e.details?.destinationCleanup?.preservedEmptyShell, true);
        return true;
      }
    );

    assert.equal(existsSync(destination), true);
    assert.deepEqual(await readdir(destination), []);
    await access(path.join(source, "launcher", "state.json"));
  });
});
