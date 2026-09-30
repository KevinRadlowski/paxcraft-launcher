/**
 * PACK-10.1SYNC-07 — Launcher update/repair qualification against local 0.1.4/seq5 candidate.
 */
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, before } from "node:test";
import {
  buildTrustedResolvedLocal,
  CASINO_NEW_FILE,
  CASINO_NEW_SHA,
  CASINO_OLD_FILE,
  CASINO_OLD_SHA,
  DELETED_MOD_IDS,
  DELETE_CONFIG_PATHS,
  loadClientManifest,
  mountLocalReleaseSource,
  PM_ROOT,
  RELEASE_013,
  RELEASE_014,
  sha256Of,
  findMod
} from "../../fixtures/sync07ReleaseHarness.js";
import { applyInstallation } from "../../src/instance/apply/index.js";
import { buildInstallationPlan } from "../../src/instance/plan/index.js";
import { InstancePaths } from "../../src/instance/layout/index.js";
import { InstanceStateStore, createEmptyInstanceState, type ManagedFileRecord } from "../../src/instance/state/instanceState.js";
import { MockByteSource } from "../../src/download/engine/sources.js";
import { InstanceLock } from "../../src/instance/lock/index.js";
import { writeBytes } from "../../fixtures/instanceHarness.js";
import { resolveSweetCraftInstanceLocation } from "../../src/instance/paths/instanceLocation.js";

const CLEAN_MODS =
  process.env.SWEETCRAFT_CLEAN_ROOT != null
    ? path.join(process.env.SWEETCRAFT_CLEAN_ROOT, "client", "mods")
    : path.resolve(PM_ROOT, "..", "..", "MODPACK FINAL CLEAN", "client", "mods");

const IPN_PATH = "config/inventoryprofilesnext/inventoryprofiles.json";

async function pmReleaseReady(): Promise<boolean> {
  try {
    await access(path.join(RELEASE_013, "client-manifest.json"));
    await access(path.join(RELEASE_014, "client-manifest.json"));
    await access(CLEAN_MODS);
    return true;
  } catch {
    return false;
  }
}

function modRecord(mod: { id: string; file: string; sha256: string; size: number }): ManagedFileRecord {
  return {
    type: "mod",
    logicalId: mod.id,
    targetPath: `mods/${mod.file}`,
    sha256: mod.sha256,
    size: mod.size,
    source: "manifest"
  };
}

function configRecord(cfg: { path: string; sha256: string; apply?: string }): ManagedFileRecord {
  return {
    type: "config",
    logicalId: cfg.path,
    targetPath: cfg.path,
    sha256: cfg.sha256,
    size: 0,
    policy: (cfg.apply as "force" | "if_missing" | "never_overwrite") ?? "force",
    source: "manifest"
  };
}

async function seed013Fixture(paths: InstancePaths, manifest013: Awaited<ReturnType<typeof loadClientManifest>>) {
  const sentinels: { rel: string; bytes: Buffer }[] = [
    { rel: "saves/SentinelWorld/level.dat", bytes: Buffer.from("SENTINEL-SAVE-v1") },
    { rel: "screenshots/sentinel.png", bytes: Buffer.from("PNG-SENTINEL") },
    { rel: "options.txt", bytes: Buffer.from("lang:fr\nsoundCategory_master:0.5\n") },
    { rel: "servers.dat", bytes: Buffer.from("SERVERS-DAT-SENTINEL") },
    { rel: "mods/user-unmanaged-sentinel.jar", bytes: Buffer.from("USER-MOD-SENTINEL") },
    { rel: "resourcepacks/user-unmanaged.zip", bytes: Buffer.from("USER-RP-SENTINEL") },
    { rel: "config/user-custom-sentinel.toml", bytes: Buffer.from("user=touched\n") }
  ];
  for (const s of sentinels) {
    await writeBytes(paths.absoluteForRelative(s.rel), s.bytes);
  }

  const casinoOldBytes = await readFile(path.join(RELEASE_013, "files", "mods", CASINO_OLD_FILE));
  assert.equal(sha256Of(casinoOldBytes), CASINO_OLD_SHA);
  await writeBytes(paths.absoluteForRelative(`mods/${CASINO_OLD_FILE}`), casinoOldBytes);

  for (const id of DELETED_MOD_IDS) {
    const mod = manifest013.mods.find(m => m.id === id);
    if (!mod) continue;
    await writeBytes(paths.absoluteForRelative(`mods/${mod.file}`), Buffer.from(`stub-${id}`));
  }

  for (const cfgPath of DELETE_CONFIG_PATHS) {
    await writeBytes(paths.absoluteForRelative(cfgPath), Buffer.from(`obsolete-${cfgPath}`));
  }

  const ipnBefore = JSON.stringify(
    {
      ModSettings: { first_run: false, custom_sort: true, user_sentinel: "KEEP-ME" },
      AutoRefillSettings: {
        refill_armor: { value: true },
        refill_before_tool_break: { value: true }
      }
    },
    null,
    4
  );
  await mkdir(path.dirname(paths.absoluteForRelative(IPN_PATH)), { recursive: true });
  await writeFile(paths.absoluteForRelative(IPN_PATH), ipnBefore, "utf8");
  const ipnHash = sha256Of(ipnBefore);

  const managed: ManagedFileRecord[] = [
    modRecord(findMod(manifest013, "xbasecasino")),
    ...DELETED_MOD_IDS.map(id => {
      const m = manifest013.mods.find(x => x.id === id);
      assert.ok(m, id);
      return modRecord(m);
    }),
    configRecord({
      path: IPN_PATH,
      sha256: ipnHash,
      apply: "if_missing"
    }),
    ...DELETE_CONFIG_PATHS.map(p => {
      const row = manifest013.configs.find(c => c.path === p);
      return configRecord({
        path: p,
        sha256: row?.sha256 ?? sha256Of(`obsolete-${p}`),
        apply: row?.apply ?? "force"
      });
    })
  ];

  const state = {
    ...createEmptyInstanceState(),
    installedPackVersion: "0.1.3",
    installedReleaseSequence: 4,
    installedReleaseSha256: "0".repeat(64),
    installedManifestSha256: "1".repeat(64),
    channel: "dev-local",
    productBase: "https://cdn.xnosweet.fr/sweetcraft",
    files: managed,
    // User-owned preferences already present — first-run ownership transferred (SYNC-12).
    appliedFirstRunSeeds: ["mc-options-firstrun", "mc-servers-sweetcraft"],
    updatedAt: new Date().toISOString()
  };
  await new InstanceStateStore(paths).saveAtomic(state);
  return { ipnBefore, sentinels };
}

const SYNC07_READY = await pmReleaseReady();
(SYNC07_READY ? describe : describe.skip)("PACK-10.1SYNC-07 update/repair qualification", () => {
  let resolved013: Awaited<ReturnType<typeof buildTrustedResolvedLocal>>;
  let resolved014: Awaited<ReturnType<typeof buildTrustedResolvedLocal>>;
  let manifest013: Awaited<ReturnType<typeof loadClientManifest>>;
  let manifest014: Awaited<ReturnType<typeof loadClientManifest>>;

  before(async () => {
    resolved013 = await buildTrustedResolvedLocal({
      releaseDir: RELEASE_013,
      packVersion: "0.1.3",
      releaseSequence: 4
    });
    resolved014 = await buildTrustedResolvedLocal({
      releaseDir: RELEASE_014,
      packVersion: "0.1.4",
      releaseSequence: 5
    });
    manifest013 = resolved013.clientManifest;
    manifest014 = resolved014.clientManifest;
    assert.equal(manifest014.mods.length, 110);
    assert.equal(
      (JSON.parse(await readFile(path.join(RELEASE_014, "server-manifest.json"), "utf8")) as { mods: unknown[] })
        .mods.length,
      94
    );
    assert.ok(!manifest014.configs.some(c => c.path.startsWith("config/jei/world/")));
  });

  it("JEI world/server runtime paths absent from 0.1.4 candidate manifest", () => {
    const jeiRuntime = [
      "config/jei/world/server/Sweet Room (vortex_dathost_net 17118)/lookupHistory.json",
      "config/jei/world/server/SweetCraft (sweetcraft_datho_st)/bookmarks.json",
      "config/jei/world/server/SweetCraft (sweetcraft_datho_st)/lookupHistory.json"
    ];
    for (const p of jeiRuntime) {
      assert.ok(!manifest014.configs.some(c => c.path === p), p);
    }
  });

  it("0.1.3 → 0.1.4 update converges managed projection", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sc-sync07-"));
    const paths = new InstancePaths(root);
    const { ipnBefore, sentinels } = await seed013Fixture(paths, manifest013);

    const source = new MockByteSource();
    await mountLocalReleaseSource(source, RELEASE_014, manifest014, resolved014.productBase, {
      cleanModsDir: CLEAN_MODS
    });

    const stateBefore = await new InstanceStateStore(paths).load();
    const plan = await buildInstallationPlan({
      resolved: resolved014,
      state: stateBefore,
      paths
    });

    assert.ok(
      plan.entries.some(
        e =>
          e.logicalId === "xbasecasino" &&
          (e.action === "DOWNLOAD" || e.action === "REPLACE") &&
          e.targetPath === `mods/${CASINO_NEW_FILE}`
      )
    );
    assert.ok(
      plan.entries.some(
        e => e.action === "DELETE_MANAGED" && e.targetPath === `mods/${CASINO_OLD_FILE}`
      )
    );
    for (const id of DELETED_MOD_IDS) {
      assert.ok(
        plan.entries.some(e => e.action === "DELETE_MANAGED" && e.logicalId === id),
        `expected DELETE_MANAGED ${id}`
      );
    }

    const result = await applyInstallation({ resolved: resolved014, paths, source });
    assert.equal(result.state.installedPackVersion, "0.1.4");
    assert.equal(result.state.installedReleaseSequence, 5);
    assert.deepEqual(result.state.appliedConfigMigrations, ["ipn-autorefill-false-from-0.1.3"]);

    const casinoPath = paths.absoluteForRelative(`mods/${CASINO_NEW_FILE}`);
    const casinoBytes = await readFile(casinoPath);
    assert.equal(sha256Of(casinoBytes), CASINO_NEW_SHA);
    await assert.rejects(() => access(paths.absoluteForRelative(`mods/${CASINO_OLD_FILE}`)));

    for (const id of DELETED_MOD_IDS) {
      const mod = manifest013.mods.find(m => m.id === id);
      if (mod) {
        await assert.rejects(() => access(paths.absoluteForRelative(`mods/${mod.file}`)));
      }
    }
    for (const cfgPath of DELETE_CONFIG_PATHS) {
      await assert.rejects(() => access(paths.absoluteForRelative(cfgPath)));
    }

    const ipnAfter = JSON.parse(await readFile(paths.absoluteForRelative(IPN_PATH), "utf8")) as Record<string, unknown>;
    assert.equal(
      (ipnAfter.ModSettings as { user_sentinel: string }).user_sentinel,
      "KEEP-ME"
    );
    assert.equal(
      (ipnAfter.AutoRefillSettings as { refill_armor: { value: boolean } }).refill_armor.value,
      false
    );
    assert.equal(
      (ipnAfter.AutoRefillSettings as { refill_before_tool_break: { value: boolean } }).refill_before_tool_break
        .value,
      false
    );

    for (const s of sentinels) {
      const got = await readFile(paths.absoluteForRelative(s.rel));
      assert.deepEqual(got, s.bytes, s.rel);
    }

    const managedMods = new Set(result.state.files.filter(f => f.type === "mod").map(f => f.targetPath));
    for (const m of manifest014.mods) {
      assert.ok(managedMods.has(`mods/${m.file}`), `missing managed mod ${m.id}`);
    }

    const fr = manifest014.resourcePacks?.find(r => r.id === "sweetcraft-fr");
    const faithful = manifest014.resourcePacks?.find(r => r.id === "faithful-64x-r13");
    assert.ok(fr?.autoEnable);
    assert.equal(faithful?.autoEnable, false);

    assert.notEqual(ipnBefore, await readFile(paths.absoluteForRelative(IPN_PATH), "utf8"));
  });

  it("repair restores corrupt managed file without repeating IPN migration", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sc-sync07-repair-"));
    const paths = new InstancePaths(root);
    await seed013Fixture(paths, manifest013);
    const source = new MockByteSource();
    await mountLocalReleaseSource(source, RELEASE_014, manifest014, resolved014.productBase, {
      cleanModsDir: CLEAN_MODS
    });
    await applyInstallation({ resolved: resolved014, paths, source });

    await writeBytes(paths.absoluteForRelative(`mods/${CASINO_NEW_FILE}`), Buffer.from("CORRUPT"));
    await writeBytes(paths.absoluteForRelative("config/amc.json"), Buffer.from("tampered"));

    const staleMod = "mods/stale-managed-residue.jar";
    await writeBytes(paths.absoluteForRelative(staleMod), Buffer.from("stale"));
    const store = new InstanceStateStore(paths);
    const st = await store.load();
    st.files.push({
      type: "mod",
      logicalId: "stalemod",
      targetPath: staleMod,
      sha256: sha256Of("stale"),
      size: 5,
      source: "manifest"
    });
    await store.saveAtomic(st);
    await writeBytes(paths.absoluteForRelative("mods/user-unmanaged-sentinel.jar"), Buffer.from("USER-MOD-SENTINEL"));

    const plan = await buildInstallationPlan({
      resolved: resolved014,
      state: await store.load(),
      paths
    });
    assert.equal(plan.entries.find(e => e.targetPath === `mods/${CASINO_NEW_FILE}`)?.action, "REPLACE");
    assert.ok(plan.entries.some(e => e.targetPath === staleMod && e.action === "DELETE_MANAGED"));

    await applyInstallation({ resolved: resolved014, paths, source });
    assert.equal(sha256Of(await readFile(paths.absoluteForRelative(`mods/${CASINO_NEW_FILE}`))), CASINO_NEW_SHA);
    await assert.rejects(() => access(paths.absoluteForRelative(staleMod)));
    assert.equal(
      (await readFile(paths.absoluteForRelative("mods/user-unmanaged-sentinel.jar"))).toString(),
      "USER-MOD-SENTINEL"
    );
    const after = await store.load();
    assert.deepEqual(after.appliedConfigMigrations, ["ipn-autorefill-false-from-0.1.3"]);
  });

  it("defer commit failure leaves prior state authoritative", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sc-sync07-fail-"));
    const paths = new InstancePaths(root);
    await seed013Fixture(paths, manifest013);
    const source = new MockByteSource();
    await mountLocalReleaseSource(source, RELEASE_014, manifest014, resolved014.productBase, {
      cleanModsDir: CLEAN_MODS
    });

    const lock = new InstanceLock(paths);
    const lease = await lock.acquire("install");
    const result = await applyInstallation({
      resolved: resolved014,
      paths,
      source,
      deferStateCommit: true,
      lockLease: lease
    });
    assert.ok(result.pending);
    assert.equal(result.state.installedPackVersion, "0.1.3");
    const disk = await new InstanceStateStore(paths).load();
    assert.equal(disk.installedPackVersion, "0.1.3");

    const retry = await applyInstallation({ resolved: resolved014, paths, source, lockLease: lease });
    await lock.releaseLease(lease);
    assert.equal(retry.state.installedPackVersion, "0.1.4");
  });

  it("custom instance location used for update apply", async () => {
    const customRoot = await mkdtemp(path.join(tmpdir(), "sc-sync07-custom-"));
    const paths = new InstancePaths(customRoot);
    const launcherData = await mkdtemp(path.join(tmpdir(), "sc-launcher-data-"));
    const resolved = resolveSweetCraftInstanceLocation({
      launcherDataRoot: launcherData,
      productUserDataRoot: path.dirname(launcherData),
      configuredInstancePath: customRoot
    });
    assert.equal(path.resolve(resolved.instanceRoot), path.resolve(customRoot));
    assert.equal(resolved.isConfigured, true);

    await seed013Fixture(paths, manifest013);
    const source = new MockByteSource();
    await mountLocalReleaseSource(source, RELEASE_014, manifest014, resolved014.productBase, {
      cleanModsDir: CLEAN_MODS
    });
    const applied = await applyInstallation({ resolved: resolved014, paths, source });
    assert.equal(applied.state.installedPackVersion, "0.1.4");
    assert.equal(path.resolve(paths.root), path.resolve(customRoot));
  });
});
