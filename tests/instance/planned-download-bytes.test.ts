import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizePlannedDownloadBytes } from "../../src/instance/plan/plannedDownloadBytes.js";

const MIB = 1024 * 1024;

describe("PACK-10.1G.6 planned download bytes", () => {
  it("sums only DOWNLOAD/REPLACE/REPAIR entries with known sizes", () => {
    const result = summarizePlannedDownloadBytes([
      { action: "DOWNLOAD", expectedSize: 20 * MIB },
      { action: "DOWNLOAD", expectedSize: 30 * MIB },
      { action: "REPLACE", expectedSize: 50 * MIB },
      { action: "KEEP", expectedSize: 999 * MIB }
    ]);
    assert.equal(result.plannedDownloadBytes, 100 * MIB);
    assert.equal(result.hasUnknownDownloadSize, false);
    assert.equal(result.plannedDownloadFiles, 3);
  });

  it("excludes already-valid KEEP from download workload", () => {
    const result = summarizePlannedDownloadBytes([
      { action: "KEEP", expectedSize: 20 * MIB },
      { action: "DOWNLOAD", expectedSize: 30 * MIB },
      { action: "DOWNLOAD", expectedSize: 50 * MIB }
    ]);
    assert.equal(result.plannedDownloadBytes, 80 * MIB);
    assert.equal(result.plannedDownloadFiles, 2);
  });

  it("marks unknown when any required download lacks size", () => {
    const result = summarizePlannedDownloadBytes([
      { action: "DOWNLOAD", expectedSize: 20 * MIB },
      { action: "DOWNLOAD", expectedSize: -1 }
    ]);
    assert.equal(result.hasUnknownDownloadSize, true);
    assert.equal(result.plannedDownloadFiles, 2);
  });

  it("treats omitted runtime library size as unknown until enriched", () => {
    const result = summarizePlannedDownloadBytes([
      { action: "DOWNLOAD", expectedSize: 2048 },
      { action: "DOWNLOAD" }
    ]);
    assert.equal(result.hasUnknownDownloadSize, true);
    assert.equal(result.plannedDownloadFiles, 2);
    assert.equal(result.plannedDownloadBytes, 2048);
  });
});
