import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MockHttpClient } from "../../src/distribution/http/index.js";
import { enrichPackPlanDownloadSizes } from "../../src/instance/plan/enrichDownloadSizes.js";
import { summarizePlannedDownloadBytes } from "../../src/instance/plan/plannedDownloadBytes.js";
import type { PlanEntry } from "../../src/instance/plan/index.js";
import { buildHarnessFiles, buildTrustedResolved } from "../../fixtures/instanceHarness.js";
import { buildInstallationPlan } from "../../src/instance/plan/index.js";
import { createEmptyInstanceState } from "../../src/instance/state/instanceState.js";
import { InstancePaths } from "../../src/instance/layout/index.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const MIB = 1024 * 1024;

describe("PACK-10.1G.6.1 pack config size enrichment", () => {
  it("resolves manifest config expectedSize=-1 via HEAD before bounded total", async () => {
    const files = buildHarnessFiles();
    const http = new MockHttpClient();
    http.set(files.configUrl, files.configBytes, {
      headers: { "content-length": String(files.configBytes.byteLength) }
    });
    http.set(
      "https://cdn.example.test/sweetcraft/releases/0.2.0/files/config/forced.toml",
      Buffer.from("forced-content"),
      { headers: { "content-length": "15" } }
    );
    http.set(
      "https://cdn.example.test/sweetcraft/releases/0.2.0/files/config/preserve.toml",
      Buffer.from("preserve-pack"),
      { headers: { "content-length": "13" } }
    );

    const entries: PlanEntry[] = [
      {
        action: "DOWNLOAD",
        kind: "config",
        logicalId: "config/example.toml",
        targetPath: "config/example.toml",
        expectedSha256: "a".repeat(64),
        expectedSize: -1,
        download: {
          id: "config:config/example.toml",
          url: files.configUrl,
          expectedSha256: "a".repeat(64),
          expectedSize: -1,
          maxBytes: 64 * MIB,
          timeoutMs: 30_000,
          targetPath: "config/example.toml"
        },
        reason: "if_missing_absent"
      },
      {
        action: "KEEP",
        kind: "mod",
        logicalId: "examplemod",
        targetPath: "mods/examplemod-1.0.0.jar",
        expectedSha256: "b".repeat(64),
        expectedSize: 20 * MIB,
        reason: "mod_ok"
      }
    ];

    const enriched = await enrichPackPlanDownloadSizes(entries, http);
    const config = enriched.find((e) => e.kind === "config");
    assert.equal(config?.expectedSize, files.configBytes.byteLength);
    assert.equal(config?.download?.expectedSize, files.configBytes.byteLength);

    const summary = summarizePlannedDownloadBytes(enriched);
    assert.equal(summary.hasUnknownDownloadSize, false);
    assert.equal(summary.plannedDownloadBytes, files.configBytes.byteLength);
    assert.equal(summary.plannedDownloadFiles, 1);
  });

  it("fresh install plan with http yields fixed network total excluding KEEP", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sc-g61-"));
    const paths = new InstancePaths(root);
    const files = buildHarnessFiles();
    const resolved = buildTrustedResolved(files);
    const http = new MockHttpClient();
    http.set(files.configUrl, files.configBytes, {
      headers: { "content-length": String(files.configBytes.byteLength) }
    });
    http.set(
      "https://cdn.example.test/sweetcraft/releases/0.2.0/files/config/forced.toml",
      Buffer.from("forced-content"),
      { headers: { "content-length": "15" } }
    );
    http.set(
      "https://cdn.example.test/sweetcraft/releases/0.2.0/files/config/preserve.toml",
      Buffer.from("preserve-pack"),
      { headers: { "content-length": "13" } }
    );

    const plan = await buildInstallationPlan({
      resolved,
      state: createEmptyInstanceState(),
      paths,
      dryRun: true,
      http
    });

    const dl = summarizePlannedDownloadBytes(plan.entries);
    assert.equal(dl.hasUnknownDownloadSize, false);
    assert.ok(dl.plannedDownloadFiles >= 3);
    assert.ok(dl.plannedDownloadBytes > 0);
    assert.equal(
      plan.entries.filter((e) => e.action === "KEEP").length,
      plan.summary.keep
    );
  });
});
