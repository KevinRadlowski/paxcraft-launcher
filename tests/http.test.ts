import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MockHttpClient } from "../src/distribution/http/index.js";
import { ErrorCode, LauncherError } from "../src/core/errors/index.js";

const BASE = "https://cdn.example.test/sweetcraft";

describe("http client", () => {
  it("returns 404 as HTTP_ERROR", async () => {
    const http = new MockHttpClient();
    await assert.rejects(
      () => http.request({ url: `${BASE}/missing.json` }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.HTTP_ERROR && e.details.status === 404
    );
  });

  it("times out when delay exceeds timeout", async () => {
    const http = new MockHttpClient();
    http.set(`${BASE}/slow.json`, "{}", { delayMs: 5_000 });
    await assert.rejects(
      () => http.request({ url: `${BASE}/slow.json`, timeoutMs: 10 }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.HTTP_TIMEOUT
    );
  });

  it("rejects oversized metadata", async () => {
    const http = new MockHttpClient();
    http.set(`${BASE}/big.json`, Buffer.alloc(1000, 0x61));
    await assert.rejects(
      () => http.request({ url: `${BASE}/big.json`, maxBytes: 100 }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.METADATA_TOO_LARGE
    );
  });

  it("rejects non-HTTPS", async () => {
    const http = new MockHttpClient();
    await assert.rejects(
      () => http.request({ url: "http://cdn.example.test/x" }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.UNSAFE_REDIRECT
    );
  });
});
