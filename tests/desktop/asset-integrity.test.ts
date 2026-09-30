import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const assetsRoot = path.join(root, "ui/src/assets");

const REQUIRED = [
  "hero/sweetcraft-home-hero.webp",
  "cards/sweetcraft-server-card.webp",
  "cards/sweetcraft-community-card.webp",
  "cards/sweetcraft-pack-art.webp",
  "cards/sweetcraft-install-art.webp",
  "ambient/sweetcraft-home-ambient-right.webp",
  "account/sweetcraft-account-hero.webp",
  "account/sweetcraft-account-community.webp",
  "settings/sweetcraft-settings-hero.webp",
  "settings/sweetcraft-settings-about.webp",
  "settings/sweetcraft-settings-banner.webp"
] as const;

describe("0.6F.2 V3.1 production asset integrity", () => {
  it("WebP assets exist, decode-sized, not tiny placeholders", () => {
    for (const rel of REQUIRED) {
      const disk = path.join(assetsRoot, rel);
      assert.ok(fs.existsSync(disk), `missing ${rel}`);
      const size = fs.statSync(disk).size;
      assert.ok(size > 20_000, `${rel} too small (${size})`);
      const buf = fs.readFileSync(disk);
      // RIFF....WEBP magic
      assert.equal(buf.toString("ascii", 0, 4), "RIFF");
      assert.equal(buf.toString("ascii", 8, 12), "WEBP");
    }
  });

  it("assets are pairwise distinct by SHA-256", async () => {
    const { createHash } = await import("node:crypto");
    const hashes = new Set<string>();
    for (const rel of REQUIRED) {
      const buf = fs.readFileSync(path.join(assetsRoot, rel));
      const h = createHash("sha256").update(buf).digest("hex");
      assert.ok(!hashes.has(h), `duplicate content: ${rel}`);
      hashes.add(h);
    }
    assert.equal(hashes.size, REQUIRED.length);
  });
});
