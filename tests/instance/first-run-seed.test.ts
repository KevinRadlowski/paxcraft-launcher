/**
 * PACK-10.1SYNC-12 / 12B — Minecraft first-run options.txt / servers.dat seeding.
 * Fresh (absent) = seed target UX; legacy (present) = byte-identical + marker only.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import {
  FIRST_RUN_SEED_OPTIONS,
  FIRST_RUN_SEED_SERVERS,
  SWEETCRAFT_DEFAULT_LANG,
  applyFirstRunSeeds,
  encodeServersDat,
  parseOptionsTxt,
  parseResourcePacksValue,
  parseServersDat,
  serializeOptionsTxt
} from "../../src/instance/firstRun/index.js";
import { InstancePaths } from "../../src/instance/layout/index.js";
import {
  createEmptyInstanceState,
  type ManagedFileRecord
} from "../../src/instance/state/instanceState.js";

async function tmpInstance(): Promise<{ root: string; paths: InstancePaths }> {
  const root = path.join(
    process.cwd(),
    "tests",
    "tmp",
    `first-run-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  await mkdir(root, { recursive: true });
  return { root, paths: new InstancePaths(root) };
}

function rp(id: string, file: string, autoEnable: boolean): ManagedFileRecord {
  return {
    type: "resourcePack",
    logicalId: id,
    targetPath: `resourcepacks/${file}`,
    sha256: "a".repeat(64),
    size: 1,
    autoEnable,
    source: "manifest"
  };
}

const MANAGED = [
  rp("sweetcraft-fr", "SweetCraft-FR-v2.7-DETAIL-PASS.zip", true),
  rp("faithful-64x-r13", "Faithful 64x - Release 13.zip", false)
];

describe("first-run fresh (absent files)", () => {
  it("absent options → fr_fr + SweetCraft-FR enabled, Faithful not enabled", async () => {
    const { paths } = await tmpInstance();
    const result = await applyFirstRunSeeds({
      paths,
      state: createEmptyInstanceState(),
      managedFiles: MANAGED
    });
    assert.ok(result);
    assert.ok(result.appliedSeedIds.includes(FIRST_RUN_SEED_OPTIONS));
    assert.ok(result.appliedSeedIds.includes(FIRST_RUN_SEED_SERVERS));

    const doc = parseOptionsTxt(await readFile(paths.absoluteForRelative("options.txt"), "utf8"));
    assert.equal(doc.values.get("lang"), SWEETCRAFT_DEFAULT_LANG);
    const packs = parseResourcePacksValue(doc.values.get("resourcePacks"));
    assert.deepEqual(packs, ["vanilla", "file/SweetCraft-FR-v2.7-DETAIL-PASS.zip"]);
    assert.ok(!packs.some(p => p.includes("Faithful")));
  });

  it("absent servers → empty list when Pax server unset (no SweetCraft seed)", async () => {
    const { paths } = await tmpInstance();
    await applyFirstRunSeeds({
      paths,
      state: createEmptyInstanceState(),
      managedFiles: MANAGED
    });
    const servers = parseServersDat(await readFile(paths.absoluteForRelative("servers.dat")));
    assert.equal(servers.length, 0);
  });
});

describe("first-run legacy (present files) — byte preservation", () => {
  it("legacy en_us → byte-identical + records options seed", async () => {
    const { paths } = await tmpInstance();
    const before = Buffer.from("lang:en_us\nsoundCategory_master:0.5\n", "utf8");
    await writeFile(paths.absoluteForRelative("options.txt"), before);
    const result = await applyFirstRunSeeds({
      paths,
      state: createEmptyInstanceState(),
      managedFiles: MANAGED
    });
    assert.ok(result);
    assert.ok(result.appliedSeedIds.includes(FIRST_RUN_SEED_OPTIONS));
    assert.deepEqual(await readFile(paths.absoluteForRelative("options.txt")), before);
  });

  it("legacy custom language → byte-identical", async () => {
    const { paths } = await tmpInstance();
    const before = Buffer.from("lang:de_de\nresourcePacks:[]\n", "utf8");
    await writeFile(paths.absoluteForRelative("options.txt"), before);
    await applyFirstRunSeeds({
      paths,
      state: createEmptyInstanceState(),
      managedFiles: MANAGED
    });
    assert.deepEqual(await readFile(paths.absoluteForRelative("options.txt")), before);
  });

  it("legacy resource packs without SweetCraft-FR → byte-identical", async () => {
    const { paths } = await tmpInstance();
    const before = Buffer.from(
      `resourcePacks:${JSON.stringify(["vanilla", "file/MyPrettyPack.zip"])}\nlang:fr_fr\n`,
      "utf8"
    );
    await writeFile(paths.absoluteForRelative("options.txt"), before);
    await applyFirstRunSeeds({
      paths,
      state: createEmptyInstanceState(),
      managedFiles: MANAGED
    });
    assert.deepEqual(await readFile(paths.absoluteForRelative("options.txt")), before);
  });

  it("legacy servers without SweetCraft → byte-identical + records servers seed", async () => {
    const { paths } = await tmpInstance();
    const before = encodeServersDat([{ name: "Hypixel", ip: "mc.hypixel.net" }]);
    await writeFile(paths.absoluteForRelative("servers.dat"), before);
    const result = await applyFirstRunSeeds({
      paths,
      state: createEmptyInstanceState(),
      managedFiles: MANAGED
    });
    assert.ok(result);
    assert.ok(result.appliedSeedIds.includes(FIRST_RUN_SEED_SERVERS));
    assert.deepEqual(await readFile(paths.absoluteForRelative("servers.dat")), before);
  });

  it("malformed options.txt → no destructive mutation + records marker", async () => {
    const { paths } = await tmpInstance();
    const before = Buffer.from("resourcePacks:NOT_JSON\nlang:en_us\n", "utf8");
    await writeFile(paths.absoluteForRelative("options.txt"), before);
    const result = await applyFirstRunSeeds({
      paths,
      state: createEmptyInstanceState(),
      managedFiles: MANAGED
    });
    assert.ok(result);
    assert.ok(result.appliedSeedIds.includes(FIRST_RUN_SEED_OPTIONS));
    assert.deepEqual(await readFile(paths.absoluteForRelative("options.txt")), before);
  });

  it("opaque / truncated servers.dat → no destructive mutation + records marker", async () => {
    const { paths } = await tmpInstance();
    const opaque = Buffer.from("SERVERS-DAT-SENTINEL", "utf8");
    await writeFile(paths.absoluteForRelative("servers.dat"), opaque);
    const truncated = Buffer.from([0x0a, 0x00, 0x00, 0x09]);
    const { paths: paths2 } = await tmpInstance();
    await writeFile(paths2.absoluteForRelative("servers.dat"), truncated);

    for (const [p, before] of [
      [paths, opaque],
      [paths2, truncated]
    ] as const) {
      const result = await applyFirstRunSeeds({
        paths: p,
        state: createEmptyInstanceState(),
        managedFiles: MANAGED
      });
      assert.ok(result);
      assert.ok(result.appliedSeedIds.includes(FIRST_RUN_SEED_SERVERS));
      assert.deepEqual(await readFile(p.absoluteForRelative("servers.dat")), before);
    }
  });
});

describe("first-run ownership / idempotence", () => {
  it("marker present → no-op", async () => {
    const { paths } = await tmpInstance();
    const first = await applyFirstRunSeeds({
      paths,
      state: createEmptyInstanceState(),
      managedFiles: MANAGED
    });
    assert.ok(first);
    const second = await applyFirstRunSeeds({
      paths,
      state: first.nextState,
      managedFiles: MANAGED
    });
    assert.equal(second, null);
  });

  it("after ownership marker, deliberate pack disable / server deletion respected", async () => {
    const { paths } = await tmpInstance();
    const first = await applyFirstRunSeeds({
      paths,
      state: createEmptyInstanceState(),
      managedFiles: MANAGED
    });
    assert.ok(first);

    const userServers = encodeServersDat([{ name: "OnlyMine", ip: "play.example.net" }]);
    await writeFile(paths.absoluteForRelative("servers.dat"), userServers);
    const userOptions = Buffer.from(
      `lang:fr_fr\nresourcePacks:${JSON.stringify(["vanilla"])}\n`,
      "utf8"
    );
    await writeFile(paths.absoluteForRelative("options.txt"), userOptions);

    const second = await applyFirstRunSeeds({
      paths,
      state: first.nextState,
      managedFiles: MANAGED
    });
    assert.equal(second, null);
    assert.deepEqual(await readFile(paths.absoluteForRelative("servers.dat")), userServers);
    assert.deepEqual(await readFile(paths.absoluteForRelative("options.txt")), userOptions);
  });

  it("legacy present files record markers without mutation (update/repair idempotence)", async () => {
    const { paths } = await tmpInstance();
    const optionsBefore = Buffer.from("lang:en_us\nfov:1.0\n", "utf8");
    const serversBefore = encodeServersDat([{ name: "Other", ip: "example.com" }]);
    await writeFile(paths.absoluteForRelative("options.txt"), optionsBefore);
    await writeFile(paths.absoluteForRelative("servers.dat"), serversBefore);

    const first = await applyFirstRunSeeds({
      paths,
      state: createEmptyInstanceState(),
      managedFiles: MANAGED
    });
    assert.ok(first);
    assert.deepEqual(first.appliedSeedIds.sort(), [
      FIRST_RUN_SEED_OPTIONS,
      FIRST_RUN_SEED_SERVERS
    ].sort());
    assert.deepEqual(await readFile(paths.absoluteForRelative("options.txt")), optionsBefore);
    assert.deepEqual(await readFile(paths.absoluteForRelative("servers.dat")), serversBefore);

    const again = await applyFirstRunSeeds({
      paths,
      state: first.nextState,
      managedFiles: MANAGED
    });
    assert.equal(again, null);
    assert.deepEqual(await readFile(paths.absoluteForRelative("options.txt")), optionsBefore);
    assert.deepEqual(await readFile(paths.absoluteForRelative("servers.dat")), serversBefore);
  });

  it("round-trips options serialize preserving keys", () => {
    const raw = "fov:1.0\r\nlang:fr_fr\r\nresourcePacks:[\"vanilla\"]\r\n";
    const doc = parseOptionsTxt(raw);
    const out = serializeOptionsTxt(doc);
    assert.match(out, /\r\n/);
    assert.equal(parseOptionsTxt(out).values.get("fov"), "1.0");
  });
});
