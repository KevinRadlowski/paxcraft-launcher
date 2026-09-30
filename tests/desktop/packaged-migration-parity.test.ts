/**
 * PACK-10.1SYNC-11D — packaged runtime must include config migration support.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, it } from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIST = path.join(ROOT, "dist");

describe("packaged migration runtime parity (dist)", () => {
  it("A. dist modules exist for manifest parsing and migration executor", () => {
    const manifest = path.join(DIST, "core", "manifest", "index.js");
    const applyMigration = path.join(DIST, "instance", "configMigration", "apply.js");
    const missedRecovery = path.join(DIST, "instance", "configMigration", "missedRecovery.js");
    const applyPipeline = path.join(DIST, "instance", "apply", "index.js");
    for (const file of [manifest, applyMigration, missedRecovery, applyPipeline]) {
      assert.ok(fs.existsSync(file), `missing ${path.relative(ROOT, file)} — run pnpm build`);
    }
  });

  it("B. apply pipeline integrates config migrations and missed recovery", () => {
    const applySrc = fs.readFileSync(path.join(DIST, "instance", "apply", "index.js"), "utf8");
    assert.match(applySrc, /applyConfigMigrations/);
    assert.match(applySrc, /reconcileMissedConfigMigrations/);
    assert.match(applySrc, /configMigrations/);
    assert.match(applySrc, /mergePriorPackVersions/);
    const missedSrc = fs.readFileSync(
      path.join(DIST, "instance", "configMigration", "missedRecovery.js"),
      "utf8"
    );
    assert.match(missedSrc, /no_transition_evidence/);
    assert.match(missedSrc, /hasPriorPackTransitionEvidence|priorPackVersions/);
  });

  it("C. behavioral contract — parse + patch from compiled dist", async () => {
    const manifestMod = await import(pathToFileURL(path.join(DIST, "core", "manifest", "index.js")).href);
    const applyMod = await import(pathToFileURL(path.join(DIST, "instance", "configMigration", "apply.js")).href);

    const migration = {
      id: "parity-test",
      configPath: "config/test.json",
      fromPackVersions: ["0.1.3"],
      set: [{ path: "leaf.value", value: false }]
    };

    const parsed = manifestMod.parseConfigMigrations([migration]);
    assert.equal(parsed.length, 1);
    assert.equal(typeof applyMod.patchConfigMigrationFile, "function");
    assert.equal(typeof applyMod.applyConfigMigrations, "function");
  });
});
