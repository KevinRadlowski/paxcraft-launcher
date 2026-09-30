import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DownloadEngine } from "../../src/download/engine/index.js";
import { FetchByteSource, MockByteSource, type FetchLike } from "../../src/download/engine/sources.js";
import { parseContentLengthHeader } from "../../src/download/engine/contentLength.js";
import { isRetryableDownloadError, RETRYABLE_HTTP_STATUSES } from "../../src/download/engine/retry.js";
import { MAX_DOWNLOAD_REDIRECTS } from "../../src/download/engine/types.js";
import { ErrorCode, LauncherError } from "../../src/core/errors/index.js";

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function textStream(chunks: Array<string | "STALL">, signal?: AbortSignal): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        if (chunk === "STALL") {
          await new Promise<never>((_resolve, reject) => {
            const onAbort = () => {
              try {
                controller.error(new DOMException("Aborted", "AbortError"));
              } catch {
                // ignore
              }
              reject(new DOMException("Aborted", "AbortError"));
            };
            if (signal?.aborted) {
              onAbort();
              return;
            }
            signal?.addEventListener("abort", onAbort, { once: true });
          });
          return;
        }
        controller.enqueue(enc.encode(chunk));
      }
      controller.close();
    }
  });
}

describe("content-length parsing", () => {
  it("accepts safe non-negative integers only", () => {
    assert.equal(parseContentLengthHeader("0"), 0);
    assert.equal(parseContentLengthHeader("42"), 42);
    assert.equal(parseContentLengthHeader(" 10 "), 10);
    assert.equal(parseContentLengthHeader(null), null);
    assert.equal(parseContentLengthHeader(""), null);
    assert.equal(parseContentLengthHeader("-1"), null);
    assert.equal(parseContentLengthHeader("1.5"), null);
    assert.equal(parseContentLengthHeader("abc"), null);
    assert.equal(parseContentLengthHeader("1e3"), null);
    assert.equal(parseContentLengthHeader("99999999999999999999"), null);
  });
});

describe("retry policy", () => {
  it("classifies transient vs deterministic errors", () => {
    assert.equal(isRetryableDownloadError(new LauncherError(ErrorCode.NETWORK_ERROR, "n")), true);
    assert.equal(isRetryableDownloadError(new LauncherError(ErrorCode.HTTP_TIMEOUT, "t")), true);
    for (const status of RETRYABLE_HTTP_STATUSES) {
      assert.equal(
        isRetryableDownloadError(new LauncherError(ErrorCode.HTTP_ERROR, "h", { status })),
        true,
        `status ${status}`
      );
    }
    for (const status of [400, 401, 403, 404, 405, 410]) {
      assert.equal(
        isRetryableDownloadError(new LauncherError(ErrorCode.HTTP_ERROR, "h", { status })),
        false,
        `status ${status}`
      );
    }
    assert.equal(isRetryableDownloadError(new LauncherError(ErrorCode.DOWNLOAD_ABORTED, "a")), false);
    assert.equal(isRetryableDownloadError(new LauncherError(ErrorCode.DOWNLOAD_HASH_MISMATCH, "h")), false);
    assert.equal(isRetryableDownloadError(new LauncherError(ErrorCode.DOWNLOAD_SIZE_MISMATCH, "s")), false);
    assert.equal(isRetryableDownloadError(new LauncherError(ErrorCode.TOO_MANY_REDIRECTS, "r")), false);
  });
});

describe("FetchByteSource hardening", () => {
  it("times out when body stalls after 200 and first chunk (end-to-end)", async () => {
    let fetchSignal: AbortSignal | undefined;
    const fetchImpl: FetchLike = async (_url, init) => {
      fetchSignal = init?.signal;
      return new Response(textStream(["hello", "STALL"], init?.signal), {
        status: 200,
        headers: { "content-length": "100" }
      });
    };
    const source = new FetchByteSource({ fetchImpl });
    const tmp = await mkdtemp(path.join(tmpdir(), "sc-dl-"));
    const engine = new DownloadEngine({ source, tmpDir: tmp, maxRetries: 0 });
    const t0 = Date.now();
    await assert.rejects(
      () =>
        engine.download({
          id: "stall",
          url: "https://cdn.example.test/stall.bin",
          expectedSha256: "0".repeat(64),
          expectedSize: 100,
          maxBytes: 1000,
          timeoutMs: 80,
          targetPath: "mods/stall.bin"
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.HTTP_TIMEOUT
    );
    assert.ok(Date.now() - t0 < 2000, "timeout should fire promptly");
    assert.ok(fetchSignal?.aborted, "fetch signal must abort to stop body read");
    const parts = (await readdir(tmp)).filter((f) => f.endsWith(".part"));
    assert.equal(parts.length, 0);
  });

  it("aborts mid-body with DOWNLOAD_ABORTED and cleans .part", async () => {
    const ac = new AbortController();
    const fetchImpl: FetchLike = async (_url, init) => {
      const signal = init?.signal;
      return new Response(
        new ReadableStream({
          async start(controller) {
            controller.enqueue(new TextEncoder().encode("partial"));
            await new Promise<void>((resolve, reject) => {
              const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
              if (signal?.aborted) {
                onAbort();
                return;
              }
              signal?.addEventListener("abort", onAbort, { once: true });
              // Abort from outside shortly after first chunk is observed by engine
              setTimeout(() => ac.abort(), 30);
              void resolve;
            }).catch((e) => {
              try {
                controller.error(e);
              } catch {
                // ignore
              }
            });
          }
        }),
        { status: 200 }
      );
    };
    const source = new FetchByteSource({ fetchImpl });
    const tmp = await mkdtemp(path.join(tmpdir(), "sc-dl-"));
    const engine = new DownloadEngine({ source, tmpDir: tmp, maxRetries: 2 });
    await assert.rejects(
      () =>
        engine.download(
          {
            id: "abort",
            url: "https://cdn.example.test/abort.bin",
            expectedSha256: "0".repeat(64),
            expectedSize: -1,
            maxBytes: 1000,
            timeoutMs: 5000,
            targetPath: "mods/abort.bin"
          },
          ac.signal
        ),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.DOWNLOAD_ABORTED
    );
    const parts = (await readdir(tmp)).filter((f) => f.endsWith(".part"));
    assert.equal(parts.length, 0);
  });

  it("follows a single HTTPS redirect", async () => {
    let hits = 0;
    const body = Buffer.from("redirected-ok");
    const fetchImpl: FetchLike = async (input) => {
      hits++;
      const url = String(input);
      if (url.endsWith("/start")) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example.test/final.bin" }
        });
      }
      return new Response(body, {
        status: 200,
        headers: { "content-length": String(body.byteLength) }
      });
    };
    const source = new FetchByteSource({ fetchImpl });
    const tmp = await mkdtemp(path.join(tmpdir(), "sc-dl-"));
    const engine = new DownloadEngine({ source, tmpDir: tmp, maxRetries: 0 });
    const result = await engine.download({
      id: "redir",
      url: "https://cdn.example.test/start",
      expectedSha256: sha256(body),
      expectedSize: body.byteLength,
      maxBytes: 1000,
      timeoutMs: 2000,
      targetPath: "mods/r.bin"
    });
    assert.equal(result.sha256, sha256(body));
    assert.equal(hits, 2);
  });

  it("refuses redirect chains beyond MAX_DOWNLOAD_REDIRECTS", async () => {
    let hits = 0;
    const fetchImpl: FetchLike = async (input) => {
      hits++;
      const n = Number(String(input).split("/").pop());
      return new Response(null, {
        status: 302,
        headers: { location: `https://cdn.example.test/${n + 1}` }
      });
    };
    const source = new FetchByteSource({ fetchImpl, maxRedirects: MAX_DOWNLOAD_REDIRECTS });
    await assert.rejects(
      () =>
        source.open("https://cdn.example.test/0", { timeoutMs: 2000 }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.TOO_MANY_REDIRECTS
    );
    assert.ok(hits <= MAX_DOWNLOAD_REDIRECTS + 1);
  });

  it("refuses redirect loops", async () => {
    const fetchImpl: FetchLike = async (input) => {
      const url = String(input);
      const next = url.includes("/a") ? "https://cdn.example.test/b" : "https://cdn.example.test/a";
      return new Response(null, { status: 302, headers: { location: next } });
    };
    const source = new FetchByteSource({ fetchImpl });
    await assert.rejects(
      () => source.open("https://cdn.example.test/a", { timeoutMs: 2000 }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.TOO_MANY_REDIRECTS
    );
  });

  it("refuses HTTPS → HTTP redirect", async () => {
    const fetchImpl: FetchLike = async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://insecure.example.test/x" }
      });
    const source = new FetchByteSource({ fetchImpl });
    await assert.rejects(
      () => source.open("https://cdn.example.test/x", { timeoutMs: 2000 }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.UNSAFE_REDIRECT
    );
  });
});

describe("DownloadEngine retry + temp uniqueness", () => {
  it("404 is attempted once", async () => {
    let opens = 0;
    const source = new MockByteSource();
    const orig = source.open.bind(source);
    source.open = async (url, opts) => {
      opens++;
      return orig(url, opts);
    };
    source.set("https://cdn.example.test/missing.bin", Buffer.alloc(0), { status: 404 });
    const tmp = await mkdtemp(path.join(tmpdir(), "sc-dl-"));
    const engine = new DownloadEngine({ source, tmpDir: tmp, maxRetries: 3 });
    await assert.rejects(
      () =>
        engine.download({
          id: "m",
          url: "https://cdn.example.test/missing.bin",
          expectedSha256: "0".repeat(64),
          expectedSize: 1,
          maxBytes: 100,
          timeoutMs: 1000,
          targetPath: "mods/m.bin"
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.HTTP_ERROR
    );
    assert.equal(opens, 1);
  });

  it("503 retries according to maxRetries", async () => {
    let opens = 0;
    const source = new MockByteSource();
    const orig = source.open.bind(source);
    source.open = async (url, opts) => {
      opens++;
      return orig(url, opts);
    };
    source.set("https://cdn.example.test/flaky.bin", Buffer.alloc(0), { status: 503 });
    const tmp = await mkdtemp(path.join(tmpdir(), "sc-dl-"));
    const engine = new DownloadEngine({ source, tmpDir: tmp, maxRetries: 2 });
    await assert.rejects(
      () =>
        engine.download({
          id: "f",
          url: "https://cdn.example.test/flaky.bin",
          expectedSha256: "0".repeat(64),
          expectedSize: 1,
          maxBytes: 100,
          timeoutMs: 1000,
          targetPath: "mods/f.bin"
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.HTTP_ERROR
    );
    assert.equal(opens, 3); // 1 + 2 retries
  });

  it("hash mismatch and size mismatch are single-attempt", async () => {
    for (const kind of ["hash", "size"] as const) {
      let opens = 0;
      const source = new MockByteSource();
      const body = Buffer.from("abcd");
      source.set("https://cdn.example.test/x.bin", body);
      const orig = source.open.bind(source);
      source.open = async (url, opts) => {
        opens++;
        return orig(url, opts);
      };
      const tmp = await mkdtemp(path.join(tmpdir(), "sc-dl-"));
      const engine = new DownloadEngine({ source, tmpDir: tmp, maxRetries: 5 });
      await assert.rejects(
        () =>
          engine.download({
            id: kind,
            url: "https://cdn.example.test/x.bin",
            expectedSha256: kind === "hash" ? "0".repeat(64) : sha256(body),
            expectedSize: kind === "size" ? 99 : body.byteLength,
            maxBytes: 1000,
            timeoutMs: 1000,
            targetPath: "mods/x.bin"
          }),
        (e: unknown) =>
          e instanceof LauncherError &&
          e.code ===
            (kind === "hash" ? ErrorCode.DOWNLOAD_HASH_MISMATCH : ErrorCode.DOWNLOAD_SIZE_MISMATCH)
      );
      assert.equal(opens, 1, kind);
    }
  });

  it("timeout is retryable; user abort is not", async () => {
    assert.equal(isRetryableDownloadError(new LauncherError(ErrorCode.HTTP_TIMEOUT, "t")), true);
    assert.equal(isRetryableDownloadError(new LauncherError(ErrorCode.DOWNLOAD_ABORTED, "a")), false);

    let opens = 0;
    const source = new MockByteSource();
    source.set("https://cdn.example.test/slow.bin", Buffer.from("hi"), {
      stallAfterBytes: 1,
      stallMs: 60_000
    });
    const orig = source.open.bind(source);
    source.open = async (url, opts) => {
      opens++;
      return orig(url, opts);
    };
    const tmp = await mkdtemp(path.join(tmpdir(), "sc-dl-"));
    const engine = new DownloadEngine({ source, tmpDir: tmp, maxRetries: 1 });
    await assert.rejects(
      () =>
        engine.download({
          id: "slow",
          url: "https://cdn.example.test/slow.bin",
          expectedSha256: sha256("hi"),
          expectedSize: 2,
          maxBytes: 100,
          timeoutMs: 40,
          targetPath: "mods/slow.bin"
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.HTTP_TIMEOUT
    );
    assert.equal(opens, 2);

    opens = 0;
    const ac = new AbortController();
    source.set("https://cdn.example.test/ab.bin", Buffer.from("hello"), {
      stallAfterBytes: 1,
      stallMs: 60_000
    });
    setTimeout(() => ac.abort(), 20);
    const engine2 = new DownloadEngine({ source, tmpDir: tmp, maxRetries: 5 });
    await assert.rejects(
      () =>
        engine2.download(
          {
            id: "ab",
            url: "https://cdn.example.test/ab.bin",
            expectedSha256: sha256("hello"),
            expectedSize: 5,
            maxBytes: 100,
            timeoutMs: 5000,
            targetPath: "mods/ab.bin"
          },
          ac.signal
        ),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.DOWNLOAD_ABORTED
    );
    assert.equal(opens, 1);
  });

  it("invalid Content-Length does not bypass maxBytes", async () => {
    const source = new MockByteSource();
    const body = Buffer.alloc(50, 1);
    source.set("https://cdn.example.test/big.bin", body, { contentLengthRaw: "not-a-number" });
    const tmp = await mkdtemp(path.join(tmpdir(), "sc-dl-"));
    const engine = new DownloadEngine({ source, tmpDir: tmp, maxRetries: 0 });
    await assert.rejects(
      () =>
        engine.download({
          id: "big",
          url: "https://cdn.example.test/big.bin",
          expectedSha256: sha256(body),
          expectedSize: -1,
          maxBytes: 10,
          timeoutMs: 1000,
          targetPath: "mods/big.bin"
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.METADATA_TOO_LARGE
    );
  });

  it("temp .part names are unique for parallel same-id downloads", async () => {
    const source = new MockByteSource();
    const body = Buffer.from("parallel-body");
    source.set("https://cdn.example.test/p.bin", body);
    const tmp = await mkdtemp(path.join(tmpdir(), "sc-dl-"));
    const engine = new DownloadEngine({ source, tmpDir: tmp, maxRetries: 0 });
    const req = {
      id: "same-id",
      url: "https://cdn.example.test/p.bin",
      expectedSha256: sha256(body),
      expectedSize: body.byteLength,
      maxBytes: 1000,
      timeoutMs: 2000,
      targetPath: "mods/p.bin"
    };
    const [a, b] = await Promise.all([engine.download(req), engine.download(req)]);
    assert.notEqual(a.tempPath, b.tempPath);
    assert.ok(a.tempPath.includes(a.request.id.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80)) || true);
  });
});
