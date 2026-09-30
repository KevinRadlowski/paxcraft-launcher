import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { parseConfigMigrations } from "../../src/core/manifest/configMigration.js";
import { applyConfigMigrations } from "../../src/instance/configMigration/apply.js";
import { setLeafPath } from "../../src/instance/configMigration/jsonPaths.js";
import { InstancePaths } from "../../src/instance/layout/index.js";
import { createEmptyInstanceState } from "../../src/instance/state/instanceState.js";
import type { ManagedFileRecord } from "../../src/instance/state/instanceState.js";
import { ErrorCode, LauncherError } from "../../src/core/errors/index.js";

const IPN_PATH = "config/inventoryprofilesnext/inventoryprofiles.json";
const MIGRATION = {
  id: "ipn-autorefill-false-from-0.1.3",
  configPath: IPN_PATH,
  fromPackVersions: ["0.1.3"],
  set: [
    { path: "AutoRefillSettings.refill_armor.value", value: false },
    { path: "AutoRefillSettings.refill_before_tool_break.value", value: false }
  ]
} as const;

async function tmpInstance(): Promise<{ root: string; paths: InstancePaths }> {
  const root = path.join(
    process.cwd(),
    "tests",
    "tmp",
    `config-migration-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  await mkdir(root, { recursive: true });
  return { root, paths: new InstancePaths(root) };
}

function ipnManaged(sha256: string, size: number): ManagedFileRecord {
  return {
    type: "config",
    logicalId: IPN_PATH,
    targetPath: IPN_PATH,
    sha256,
    size,
    policy: "if_missing",
    source: "manifest"
  };
}

describe("config migration manifest contract", () => {
  it("parses IPN migration with constrained set paths", () => {
    const parsed = parseConfigMigrations([MIGRATION]);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]!.id, MIGRATION.id);
    assert.equal(parsed[0]!.set.length, 2);
  });

  it("rejects arbitrary path segments", () => {
    assert.throws(() =>
      parseConfigMigrations([
        {
          ...MIGRATION,
          set: [{ path: "AutoRefillSettings.refill_armor../value", value: false }]
        }
      ])
    );
  });
});

describe("applyConfigMigrations — IPN 0.1.3 → future", () => {
  it("skips when file absent (fresh install uses if_missing seed)", async () => {
    const { paths } = await tmpInstance();
    const previous = {
      ...createEmptyInstanceState(),
      installedPackVersion: "0.1.3"
    };
    const result = await applyConfigMigrations({
      migrations: [MIGRATION],
      paths,
      previousState: previous,
      managedFiles: []
    });
    assert.deepEqual(result.appliedIds, []);
  });

  it("0.1.3-like file receives only AutoRefill false keys; ModSettings preserved", async () => {
    const { paths } = await tmpInstance();
    const before = JSON.stringify(
      { ModSettings: { first_run: false, custom_sort: true } },
      null,
      4
    );
    await mkdir(path.dirname(paths.absoluteForRelative(IPN_PATH)), { recursive: true });
    await writeFile(paths.absoluteForRelative(IPN_PATH), before, "utf8");

    const previous = {
      ...createEmptyInstanceState(),
      installedPackVersion: "0.1.3"
    };
    const result = await applyConfigMigrations({
      migrations: [MIGRATION],
      paths,
      previousState: previous,
      managedFiles: [ipnManaged("a".repeat(64), before.length)]
    });

    assert.deepEqual(result.appliedIds, [MIGRATION.id]);
    const after = JSON.parse(await readFile(paths.absoluteForRelative(IPN_PATH), "utf8")) as Record<
      string,
      unknown
    >;
    assert.deepEqual(after.ModSettings, { first_run: false, custom_sort: true });
    assert.equal(
      (after.AutoRefillSettings as { refill_armor: { value: boolean } }).refill_armor.value,
      false
    );
    assert.equal(
      (
        after.AutoRefillSettings as {
          refill_before_tool_break: { value: boolean };
        }
      ).refill_before_tool_break.value,
      false
    );
  });

  it("idempotent when keys already false", async () => {
    const { paths } = await tmpInstance();
    const payload =
      JSON.stringify(
        {
          ModSettings: { first_run: false },
          AutoRefillSettings: {
            refill_armor: { value: false },
            refill_before_tool_break: { value: false }
          }
        },
        null,
        4
      ) + "\n";
    await mkdir(path.dirname(paths.absoluteForRelative(IPN_PATH)), { recursive: true });
    await writeFile(paths.absoluteForRelative(IPN_PATH), payload, "utf8");

    const previous = {
      ...createEmptyInstanceState(),
      installedPackVersion: "0.1.3",
      appliedConfigMigrations: []
    };
    const first = await applyConfigMigrations({
      migrations: [MIGRATION],
      paths,
      previousState: previous,
      managedFiles: [ipnManaged("b".repeat(64), payload.length)]
    });
    assert.deepEqual(first.appliedIds, [MIGRATION.id]);

    const second = await applyConfigMigrations({
      migrations: [MIGRATION],
      paths,
      previousState: {
        ...previous,
        appliedConfigMigrations: [MIGRATION.id]
      },
      managedFiles: first.files
    });
    assert.deepEqual(second.appliedIds, []);
    assert.equal(await readFile(paths.absoluteForRelative(IPN_PATH), "utf8"), payload);
  });

  it("does not run for fresh 0.1.4 install (fromPackVersions gate)", async () => {
    const { paths } = await tmpInstance();
    const payload = JSON.stringify({ ModSettings: { first_run: false } }, null, 4);
    await mkdir(path.dirname(paths.absoluteForRelative(IPN_PATH)), { recursive: true });
    await writeFile(paths.absoluteForRelative(IPN_PATH), payload, "utf8");

    const result = await applyConfigMigrations({
      migrations: [MIGRATION],
      paths,
      previousState: createEmptyInstanceState(),
      managedFiles: [ipnManaged("c".repeat(64), payload.length)]
    });
    assert.deepEqual(result.appliedIds, []);
    assert.equal(
      JSON.stringify(JSON.parse(await readFile(paths.absoluteForRelative(IPN_PATH), "utf8"))),
      JSON.stringify(JSON.parse(payload))
    );
  });

  it("malformed JSON fails closed without write", async () => {
    const { paths } = await tmpInstance();
    await mkdir(path.dirname(paths.absoluteForRelative(IPN_PATH)), { recursive: true });
    await writeFile(paths.absoluteForRelative(IPN_PATH), "{not-json", "utf8");

    await assert.rejects(
      async () =>
        applyConfigMigrations({
          migrations: [MIGRATION],
          paths,
          previousState: { ...createEmptyInstanceState(), installedPackVersion: "0.1.3" },
          managedFiles: []
        }),
      (e: unknown) => LauncherError.isLauncherError(e) && e.code === ErrorCode.CONFIG_MIGRATION_FAILED
    );
    assert.equal(await readFile(paths.absoluteForRelative(IPN_PATH), "utf8"), "{not-json");
  });

  it("wrong intermediate shape fails closed", async () => {
    const root: Record<string, unknown> = {
      AutoRefillSettings: "string-not-object"
    };
    assert.throws(() => setLeafPath(root, "AutoRefillSettings.refill_armor.value", false));
  });
});
