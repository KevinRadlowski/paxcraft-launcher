import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MockHttpClient } from "../../src/distribution/http/index.js";
import {
  probeRemoteContentLength,
  resolveUniqueContentLengths
} from "../../src/download/planning/probeContentLength.js";

describe("PACK-10.1G.6.1 download size probe", () => {
  it("HEAD resolves Content-Length without transferring body", async () => {
    const http = new MockHttpClient();
    const url = "https://cdn.example.test/sweetcraft/releases/0.2.0/files/config/example.toml";
    http.set(url, Buffer.from("key=value\n"), {
      headers: { "content-length": "4096" }
    });
    const size = await probeRemoteContentLength(http, url);
    assert.equal(size, 4096);
  });

  it("returns null when HEAD lacks Content-Length", async () => {
    const http = new MockHttpClient();
    const url = "https://cdn.example.test/no-length.bin";
    http.set(url, Buffer.alloc(0), { headers: {} });
    const size = await probeRemoteContentLength(http, url);
    assert.equal(size, null);
  });

  it("dedupes concurrent probes for the same URL", async () => {
    const http = new MockHttpClient();
    const url = "https://cdn.example.test/lib.jar";
    http.set(url, Buffer.alloc(8192), {
      headers: { "content-length": "8192" }
    });
    const sizes = await resolveUniqueContentLengths(http, [url, url, url]);
    assert.equal(sizes.size, 1);
    assert.equal(sizes.get(url), 8192);
  });
});
