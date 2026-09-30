import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MockHttpClient } from "../../src/distribution/http/index.js";
import { enrichRuntimePlanDownloadSizes } from "../../src/minecraft/runtime/enrichDownloadSizes.js";
import { summarizePlannedDownloadBytes } from "../../src/instance/plan/plannedDownloadBytes.js";
import type { RuntimePlanEntry } from "../../src/minecraft/runtime/types.js";

describe("PACK-10.1G.6.1 runtime library size enrichment", () => {
  it("resolves Maven library without inline size via HEAD", async () => {
    const url = "https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.19.3/fabric-loader-0.19.3.jar";
    const http = new MockHttpClient();
    http.set(url, Buffer.alloc(0), { headers: { "content-length": "524288" } });

    const entries: RuntimePlanEntry[] = [
      {
        action: "DOWNLOAD",
        kind: "library",
        id: "net.fabricmc:fabric-loader:0.19.3",
        relativePath: "libraries/net/fabricmc/fabric-loader/0.19.3/fabric-loader-0.19.3.jar",
        url,
        integrity: { algorithm: "sha1", digest: "a".repeat(40) },
        reason: "library_missing"
      },
      {
        action: "DOWNLOAD",
        kind: "asset",
        id: "abc123",
        relativePath: "assets/ab/c123",
        url: "https://resources.download.minecraft.net/ab/c123",
        integrity: { algorithm: "sha1", digest: "abc123" },
        expectedSize: 2048,
        reason: "asset_missing"
      }
    ];

    const enriched = await enrichRuntimePlanDownloadSizes(entries, http);
    const lib = enriched.find((e) => e.kind === "library");
    assert.equal(lib?.expectedSize, 524288);

    const summary = summarizePlannedDownloadBytes(enriched);
    assert.equal(summary.hasUnknownDownloadSize, false);
    assert.equal(summary.plannedDownloadBytes, 524288 + 2048);
    assert.equal(summary.plannedDownloadFiles, 2);
  });
});
