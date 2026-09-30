/**
 * PACK-10.1SYNC-12E — missed-migration recovery requires durable priorPackVersions evidence.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import type { TrustedResolvedRelease } from "../../src/core/resolve/index.js";
import type { ManifestConfigMigration } from "../../src/core/manifest/configMigration.js";
import {
  evaluateMissedMigrationRecovery,
  hasPriorPackTransitionEvidence,
  planMissedConfigMigrationRecoveries,
  reconcileMissedConfigMigrations
} from "../../src/instance/configMigration/missedRecovery.js";
import { applyFirstRunSeeds } from "../../src/instance/firstRun/seed.js";
import { InstancePaths } from "../../src/instance/layout/index.js";
import {
  createEmptyInstanceState,
  mergePriorPackVersions
} from "../../src/instance/state/instanceState.js";
import { ErrorCode, LauncherError } from "../../src/core/errors/index.js";

const IPN_PATH = "config/inventoryprofilesnext/inventoryprofiles.json";
const MIGRATION: ManifestConfigMigration = {
  id: "ipn-autorefill-false-from-0.1.3",
  configPath: IPN_PATH,
  fromPackVersions: ["0.1.3"],
  set: [
    { path: "AutoRefillSettings.refill_armor.value", value: false },
    { path: "AutoRefillSettings.refill_before_tool_break.value", value: false }
  ]
};

const RELEASE_SHA = "a".repeat(64);
const MANIFEST_SHA = "b".repeat(64);

async function tmpInstance(): Promise<{ paths: InstancePaths }> {
  const root = path.join(
    process.cwd(),
    "tests",
    "tmp",
    `missed-recovery-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  await mkdir(root, { recursive: true });
  return { paths: new InstancePaths(root) };
}

function mockResolved(migrations: ManifestConfigMigration[] = [MIGRATION]): TrustedResolvedRelease {
  return {
    trusted: true,
    channel: {} as TrustedResolvedRelease["channel"],
    release: {
      trusted: true,
      release: {
        packVersion: "0.1.4",
        artefacts: {
          clientManifest: { sha256: MANIFEST_SHA, path: "client-manifest.json", size: 1 }
        }
      } as TrustedResolvedRelease["release"]["release"],
      releaseBytesSha256: RELEASE_SHA,
      publicKeyId: "test"
    },
    clientManifest: {
      packVersion: "0.1.4",
      configMigrations: migrations
    } as TrustedResolvedRelease["clientManifest"],
    productBase: "https://example.test",
    candidate: {
      channel: "dev",
      releaseSequence: 5,
      packVersion: "0.1.4",
      releasePath: "releases/0.1.4/release.json",
      releaseSha256: RELEASE_SHA
    }
  };
}

/** Fresh/current 0.1.4 state without traversed source versions. */
function state014(extra: Partial<ReturnType<typeof createEmptyInstanceState>> = {}) {
  return {
    ...createEmptyInstanceState(),
    installedPackVersion: "0.1.4",
    installedReleaseSequence: 5,
    installedReleaseSha256: RELEASE_SHA,
    installedManifestSha256: MANIFEST_SHA,
    ...extra
  };
}

/** Proven historical transition evidence (rc.17 advanced to 0.1.4 after 0.1.3). */
function state014After013(extra: Partial<ReturnType<typeof createEmptyInstanceState>> = {}) {
  return state014({ priorPackVersions: ["0.1.3"], ...extra });
}

async function writeIpn(paths: InstancePaths, payload: unknown): Promise<void> {
  await mkdir(path.dirname(paths.absoluteForRelative(IPN_PATH)), { recursive: true });
  await writeFile(paths.absoluteForRelative(IPN_PATH), JSON.stringify(payload, null, 4), "utf8");
}

const PACK_LIKE_IPN = {
  ModSettings: { first_run: false },
  AutoRefillSettings: {
    refill_armor: { value: false },
    refill_before_tool_break: { value: false }
  }
};

describe("priorPackVersions helper", () => {
  it("fresh null → first version does not invent prior history", () => {
    assert.equal(
      mergePriorPackVersions({ installedPackVersion: null, priorPackVersions: undefined }, "0.1.4"),
      undefined
    );
  });

  it("records previous version on pack advance", () => {
    assert.deepEqual(
      mergePriorPackVersions({ installedPackVersion: "0.1.3", priorPackVersions: undefined }, "0.1.4"),
      ["0.1.3"]
    );
  });

  it("hasPriorPackTransitionEvidence requires intersection with fromPackVersions", () => {
    assert.equal(hasPriorPackTransitionEvidence({}, ["0.1.3"]), false);
    assert.equal(hasPriorPackTransitionEvidence({ priorPackVersions: ["0.1.4"] }, ["0.1.3"]), false);
    assert.equal(hasPriorPackTransitionEvidence({ priorPackVersions: ["0.1.3"] }, ["0.1.3"]), true);
  });
});

describe("missed config migration recovery — eligibility", () => {
  it("A. fresh null→0.1.4: no missed recovery (no prior transition)", async () => {
    const { paths } = await tmpInstance();
    await writeIpn(paths, { ModSettings: { first_run: false } });
    const outcome = await evaluateMissedMigrationRecovery(MIGRATION, {
      state: state014(),
      resolved: mockResolved(),
      paths
    });
    assert.equal(outcome.kind, "skip");
    if (outcome.kind === "skip") assert.equal(outcome.reason, "no_transition_evidence");
  });

  it("B. fresh target already has desired leafs: still no recovery/marker", async () => {
    const { paths } = await tmpInstance();
    await writeIpn(paths, PACK_LIKE_IPN);
    const outcome = await evaluateMissedMigrationRecovery(MIGRATION, {
      state: state014(),
      resolved: mockResolved(),
      paths
    });
    assert.equal(outcome.kind, "skip");
    if (outcome.kind === "skip") assert.equal(outcome.reason, "no_transition_evidence");
    const planned = await planMissedConfigMigrationRecoveries({
      state: state014(),
      resolved: mockResolved(),
      paths
    });
    assert.deepEqual(planned, []);
  });

  it("C. proven historical 0.1.3→0.1.4 old-client miss: recovery eligible", async () => {
    const { paths } = await tmpInstance();
    await writeIpn(paths, { ModSettings: { first_run: false } });
    const outcome = await evaluateMissedMigrationRecovery(MIGRATION, {
      state: state014After013(),
      resolved: mockResolved(),
      paths
    });
    assert.equal(outcome.kind, "eligible");
  });

  it("C2. historical with converged leafs still eligible for record-only when prior proven", async () => {
    const { paths } = await tmpInstance();
    await writeIpn(paths, PACK_LIKE_IPN);
    const outcome = await evaluateMissedMigrationRecovery(MIGRATION, {
      state: state014After013(),
      resolved: mockResolved(),
      paths
    });
    assert.equal(outcome.kind, "eligible");
  });

  it("D. historical user-modified unsafe leaf: fail-closed reject", async () => {
    const { paths } = await tmpInstance();
    await writeIpn(paths, {
      ModSettings: { first_run: false },
      AutoRefillSettings: { refill_armor: { value: true } }
    });
    const outcome = await evaluateMissedMigrationRecovery(MIGRATION, {
      state: state014After013(),
      resolved: mockResolved(),
      paths
    });
    assert.equal(outcome.kind, "reject");
    if (outcome.kind === "reject") assert.equal(outcome.reason, "user_modified_leaf");
  });

  it("E. already-applied id: no-op", async () => {
    const { paths } = await tmpInstance();
    await writeIpn(paths, { ModSettings: { first_run: false } });
    const outcome = await evaluateMissedMigrationRecovery(MIGRATION, {
      state: state014After013({ appliedConfigMigrations: [MIGRATION.id] }),
      resolved: mockResolved(),
      paths
    });
    assert.equal(outcome.kind, "skip");
    if (outcome.kind === "skip") assert.equal(outcome.reason, "already_applied");
  });

  it("F. untrusted/mismatched release or manifest: no recovery", async () => {
    const { paths } = await tmpInstance();
    await writeIpn(paths, { ModSettings: { first_run: false } });
    const outcome = await evaluateMissedMigrationRecovery(MIGRATION, {
      state: state014After013({ installedReleaseSha256: "c".repeat(64) }),
      resolved: mockResolved(),
      paths
    });
    assert.equal(outcome.kind, "skip");
    if (outcome.kind === "skip") assert.equal(outcome.reason, "release_identity_mismatch");
  });

  it("skips fresh 0.1.4 when target file absent", async () => {
    const { paths } = await tmpInstance();
    const outcome = await evaluateMissedMigrationRecovery(MIGRATION, {
      state: state014After013(),
      resolved: mockResolved(),
      paths
    });
    assert.equal(outcome.kind, "skip");
    if (outcome.kind === "skip") assert.equal(outcome.reason, "target_file_absent");
  });

  it("rejects malformed JSON fail-closed when transition proven", async () => {
    const { paths } = await tmpInstance();
    await mkdir(path.dirname(paths.absoluteForRelative(IPN_PATH)), { recursive: true });
    await writeFile(paths.absoluteForRelative(IPN_PATH), "{bad", "utf8");
    const outcome = await evaluateMissedMigrationRecovery(MIGRATION, {
      state: state014After013(),
      resolved: mockResolved(),
      paths
    });
    assert.equal(outcome.kind, "reject");
    if (outcome.kind === "reject") assert.equal(outcome.reason, "malformed_json");
  });
});

describe("missed config migration recovery — apply", () => {
  it("patches minimal IPN leaf-only and records migration id when prior proven", async () => {
    const { paths } = await tmpInstance();
    await writeIpn(paths, { ModSettings: { first_run: false, custom: true } });
    const recovered = await reconcileMissedConfigMigrations({
      state: state014After013(),
      resolved: mockResolved(),
      paths
    });
    assert.ok(recovered);
    assert.deepEqual(recovered.appliedIds, [MIGRATION.id]);
    const after = JSON.parse(await readFile(paths.absoluteForRelative(IPN_PATH), "utf8")) as Record<
      string,
      unknown
    >;
    assert.deepEqual(after.ModSettings, { first_run: false, custom: true });
    assert.equal(
      (after.AutoRefillSettings as { refill_armor: { value: boolean } }).refill_armor.value,
      false
    );
    assert.deepEqual(recovered.nextState.appliedConfigMigrations, [MIGRATION.id]);
    assert.deepEqual(recovered.nextState.priorPackVersions, ["0.1.3"]);
  });

  it("G. repair/update idempotence", async () => {
    const { paths } = await tmpInstance();
    await writeIpn(paths, { ModSettings: { first_run: false } });
    const first = await reconcileMissedConfigMigrations({
      state: state014After013(),
      resolved: mockResolved(),
      paths
    });
    assert.ok(first);
    const second = await reconcileMissedConfigMigrations({
      state: first.nextState,
      resolved: mockResolved(),
      paths
    });
    assert.equal(second, null);
    const planned = await planMissedConfigMigrationRecoveries({
      state: first.nextState,
      resolved: mockResolved(),
      paths
    });
    assert.deepEqual(planned, []);
  });

  it("fresh state never records migration via reconcile", async () => {
    const { paths } = await tmpInstance();
    await writeIpn(paths, PACK_LIKE_IPN);
    const recovered = await reconcileMissedConfigMigrations({
      state: state014(),
      resolved: mockResolved(),
      paths
    });
    assert.equal(recovered, null);
  });

  it("plan rejects unsafe state fail-closed when prior proven", async () => {
    const { paths } = await tmpInstance();
    await writeIpn(paths, {
      ModSettings: { first_run: false },
      AutoRefillSettings: { refill_armor: { value: true } }
    });
    await assert.rejects(
      async () =>
        planMissedConfigMigrationRecoveries({
          state: state014After013(),
          resolved: mockResolved(),
          paths
        }),
      (e: unknown) => LauncherError.isLauncherError(e) && e.code === ErrorCode.CONFIG_MIGRATION_FAILED
    );
  });

  it("H. firstRun seeds remain unaffected by missed-recovery gating", async () => {
    const { paths } = await tmpInstance();
    const managed = [
      {
        type: "resourcePack" as const,
        logicalId: "sweetcraft-fr",
        targetPath: "resourcepacks/SweetCraft-FR-v2.7-DETAIL-PASS.zip",
        sha256: "a".repeat(64),
        size: 1,
        autoEnable: true,
        source: "manifest" as const
      }
    ];
    const seeded = await applyFirstRunSeeds({
      paths,
      state: state014(),
      managedFiles: managed
    });
    assert.ok(seeded);
    assert.ok(seeded.appliedSeedIds.includes("mc-options-firstrun"));
    const raw = await readFile(paths.absoluteForRelative("options.txt"), "utf8");
    assert.match(raw, /lang:fr_fr/);
  });
});
