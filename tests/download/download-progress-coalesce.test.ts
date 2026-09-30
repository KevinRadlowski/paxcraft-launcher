import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DownloadEngine } from "../../src/download/engine/index.js";
import { MockByteSource } from "../../src/download/engine/sources.js";
import { ProgressEmitter } from "../../src/instance/events/index.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

describe("PACK-10.1G.6.1 download progress coalescing", () => {
  it("coalesces chunk progress and preserves final byte count", async () => {
    const mockChunkSize = 64 * 1024;
    const streamChunks = 200;
    const payload = Buffer.alloc(mockChunkSize * streamChunks, 0xab);
    const digest = createHash("sha256").update(payload).digest("hex");
    const url = "https://cdn.example.test/large.bin";

    const source = new MockByteSource();
    source.set(url, payload);

    const emitter = new ProgressEmitter();
    let progressEvents = 0;
    let lastBytes = 0;
    emitter.on((ev) => {
      if (ev.type !== "DOWNLOAD_PROGRESS") return;
      progressEvents += 1;
      lastBytes = ev.data["bytesReceived"] as number;
    });

    const tmpDir = await mkdtemp(path.join(tmpdir(), "sc-coalesce-"));
    const engine = new DownloadEngine({
      source,
      tmpDir,
      emitter,
      minProgressEmitIntervalMs: 100,
      now: (() => {
        let t = 0;
        return () => {
          t += 50;
          return t;
        };
      })()
    });

    await engine.download({
      id: "large",
      url,
      expectedSha256: digest,
      expectedSize: payload.byteLength,
      maxBytes: payload.byteLength + 1024,
      timeoutMs: 30_000,
      targetPath: "large.bin"
    });

    assert.ok(
      progressEvents < streamChunks,
      `expected coalescing, got ${progressEvents} from ${streamChunks} stream chunks`
    );
    assert.ok(progressEvents >= 2);
    assert.equal(lastBytes, payload.byteLength);
  });

  it("aggregator coalesces burst progress below raw event rate", async () => {
    const { createInstallProgressAggregator } = await import(
      "../../desktop/main/install/install-progress-aggregator.js"
    );

    const out: unknown[] = [];
    const agg = createInstallProgressAggregator((p) => out.push(p), {
      minEmitIntervalMs: 100,
      now: (() => {
        let t = 0;
        return () => {
          t += 1;
          return t;
        };
      })()
    });

    agg.handleEvent({
      type: "PLAN_READY",
      data: {
        dryRun: false,
        plannedDownloadBytes: 1_000_000,
        hasUnknownDownloadSize: false,
        plannedDownloadFiles: 1
      }
    });
    agg.handleEvent({
      type: "OPERATION_PROGRESS",
      data: { operation: "install", phase: "DOWNLOADING" }
    });
    agg.handleEvent({
      type: "DOWNLOAD_STARTED",
      data: { id: "a", expectedSize: 1_000_000, targetPath: "f.jar" }
    });

    for (let i = 1; i <= 500; i += 1) {
      agg.handleEvent({
        type: "DOWNLOAD_PROGRESS",
        data: { id: "a", bytesReceived: i * 1000 }
      });
    }
    agg.flush();

    const stats = agg.getStats();
    assert.equal(stats.rawEvents, 503);
    assert.ok(stats.forwardedEvents < 20, `forwarded ${stats.forwardedEvents} should be << 500 raw`);
    assert.ok(stats.forwardedEvents >= 3);
    const last = out[out.length - 1] as { completedBytes?: number };
    assert.equal(last.completedBytes, 500_000);
  });
});
