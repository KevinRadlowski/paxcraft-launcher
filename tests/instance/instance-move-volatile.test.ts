import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { access, appendFile, mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildTreeManifest,
  isVolatileMigrationPath,
  moveInstanceTree,
  verifyTreeAgainstManifest
} from "../../src/instance/move/index.js";
import { buildInstancePathGuardContext } from "../../src/instance/paths/instanceLocation.js";
import { ErrorCode, LauncherError } from "../../src/core/errors/index.js";
import { INSTANCE_STATE_SCHEMA_VERSION } from "../../src/instance/state/instanceState.js";

async function seedInstance(root: string, logBytes = 100): Promise<void> {
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
  await writeFile(path.join(root, "config", "fabric.json"), "{}");
  await writeFile(path.join(root, "resourcepacks", "pack.zip"), "zip");
  await writeFile(path.join(root, "logs", "live.log"), "a".repeat(logBytes));
  await writeFile(path.join(root, "options.txt"), "lang:fr");
}

async function guard() {
  const userData = await mkdtemp(path.join(tmpdir(), "sc-vol-ud-"));
  const launcherData = path.join(userData, "launcher-data");
  await mkdir(launcherData, { recursive: true });
  return buildInstancePathGuardContext(launcherData, userData);
}

describe("PACK-10.1G.5.1 volatile path classification", () => {
  it("logs/** is volatile; stable user data is not", () => {
    assert.equal(isVolatileMigrationPath("logs/live.log"), true);
    assert.equal(isVolatileMigrationPath("logs/latest.log"), true);
    assert.equal(isVolatileMigrationPath("launcher/state.json"), false);
    assert.equal(isVolatileMigrationPath("mods/personal.jar"), false);
    assert.equal(isVolatileMigrationPath("saves/MyWorld/level.dat"), false);
    assert.equal(isVolatileMigrationPath("config/fabric.json"), false);
    assert.equal(isVolatileMigrationPath("resourcepacks/pack.zip"), false);
    assert.equal(isVolatileMigrationPath("options.txt"), false);
    assert.equal(isVolatileMigrationPath("crash-reports/crash.txt"), false);
  });
});

describe("PACK-10.1G.5.1 adversarial live source mutation", () => {
  it("G.5 weak test ordering: mutation AFTER copy does not exercise copy/read race", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "sc-vol-ordering-"));
    const source = path.join(base, "source");
    const destination = path.join(base, "dest");
    await seedInstance(source, 100);
    const logPath = path.join(source, "logs", "live.log");
    const pathGuard = await guard();

    const manifest = await buildTreeManifest(source);
    const logRecord = manifest.files.find((f) => f.relativePath === "logs/live.log");
    assert.ok(logRecord);
    assert.equal(logRecord.size, 100);

    let copiedLogSize = -1;
    let sourceLogSizeAfterMutation = -1;
    await moveInstanceTree({
      sourceRoot: source,
      destinationRoot: destination,
      guard: pathGuard,
      freeSpaceFn: async () => Number.MAX_SAFE_INTEGER,
      copyTreeFn: async (from, to) => {
        const { cp } = await import("node:fs/promises");
        await cp(from, to, { recursive: true, force: true });
        copiedLogSize = (await stat(path.join(to, "logs", "live.log"))).size;
        await appendFile(logPath, "post-copy mutation\n");
        sourceLogSizeAfterMutation = (await stat(logPath)).size;
      },
      commitLocationFn: async () => {}
    });

    assert.equal(copiedLogSize, 100);
    assert.ok(sourceLogSizeAfterMutation > 100);
  });

  it("PASS: manifest N, mutate to N+X before copy reads, destination > manifest size", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "sc-vol-adversarial-"));
    const source = path.join(base, "source");
    const destination = path.join(base, "dest");
    await seedInstance(source, 100);
    const logPath = path.join(source, "logs", "live.log");
    const pathGuard = await guard();
    let manifestLogSize = -1;
    let copiedLogSize = -1;

    const result = await moveInstanceTree({
      sourceRoot: source,
      destinationRoot: destination,
      guard: pathGuard,
      freeSpaceFn: async () => Number.MAX_SAFE_INTEGER,
      copyTreeFn: async (from, to) => {
        const manifest = await buildTreeManifest(from);
        const logRecord = manifest.files.find((f) => f.relativePath === "logs/live.log");
        assert.ok(logRecord);
        manifestLogSize = logRecord.size;
        assert.equal(manifestLogSize, 100);

        await appendFile(logPath, "b".repeat(50));
        assert.equal((await stat(logPath)).size, 150);

        const { cp } = await import("node:fs/promises");
        await cp(from, to, { recursive: true, force: true });
        copiedLogSize = (await stat(path.join(to, "logs", "live.log"))).size;
      },
      commitLocationFn: async () => {}
    });

    assert.equal(result.strategy, "copy");
    assert.equal(manifestLogSize, 100);
    assert.equal(copiedLogSize, 150);
    assert.ok(copiedLogSize > manifestLogSize);

    const dstLog = await readFile(path.join(destination, "logs", "live.log"));
    assert.equal(dstLog.length, 150);
    await access(path.join(destination, "saves", "MyWorld", "level.dat"));
    await access(path.join(destination, "mods", "personal.jar"));
    await access(path.join(destination, "launcher", "state.json"));
    await assert.rejects(() => access(source));
  });

  it("FAIL: stable file mutation during copy blocks commit and preserves source", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "sc-vol-stable-fail-"));
    const source = path.join(base, "source");
    const destination = path.join(base, "dest");
    await seedInstance(source, 100);
    const stablePath = path.join(source, "mods", "personal.jar");
    const pathGuard = await guard();
    let committed = false;

    await assert.rejects(
      () =>
        moveInstanceTree({
          sourceRoot: source,
          destinationRoot: destination,
          guard: pathGuard,
          freeSpaceFn: async () => Number.MAX_SAFE_INTEGER,
          copyTreeFn: async (from, to) => {
            await writeFile(stablePath, "mutated-stable-content");
            const { cp } = await import("node:fs/promises");
            await cp(from, to, { recursive: true, force: true });
          },
          commitLocationFn: async () => {
            committed = true;
          }
        }),
      (e: unknown) => {
        assert.ok(e instanceof LauncherError);
        assert.equal(e.code, ErrorCode.INSTANCE_MOVE_FAILED);
        assert.equal(e.details?.phase, "VERIFYING");
        assert.equal(e.details?.preservedSource, true);
        return true;
      }
    );

    assert.equal(committed, false);
    assert.equal(await readFile(stablePath, "utf8"), "mutated-stable-content");
    await access(source);
    assert.equal(existsSync(destination), false);
  });

  it("verifyTreeAgainstManifest rejects stable size drift directly", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "sc-vol-verify-"));
    const source = path.join(base, "source");
    const destination = path.join(base, "dest");
    await seedInstance(source, 100);
    const manifest = await buildTreeManifest(source);

    const { cp } = await import("node:fs/promises");
    await cp(source, destination, { recursive: true, force: true });
    await writeFile(path.join(destination, "mods", "personal.jar"), "changed");

    await assert.rejects(
      () => verifyTreeAgainstManifest(manifest, destination),
      (e: unknown) =>
        e instanceof LauncherError &&
        e.message.includes("verification") &&
        e.message.includes("size mismatch")
    );
  });

  it("verifyTreeAgainstManifest accepts volatile log growth on destination", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "sc-vol-verify-ok-"));
    const source = path.join(base, "source");
    const destination = path.join(base, "dest");
    await seedInstance(source, 100);
    const manifest = await buildTreeManifest(source);

    const { cp } = await import("node:fs/promises");
    await cp(source, destination, { recursive: true, force: true });
    await appendFile(path.join(destination, "logs", "live.log"), "b".repeat(50));

    await verifyTreeAgainstManifest(manifest, destination);
  });
});
