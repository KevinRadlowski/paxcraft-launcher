/**
 * PACK-12F.1 — build provenance is HEAD-derived; not commit-stable SoT.
 * Docs-only commits must not fail version:check due to stale committed build.generated.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  BUILD_GENERATED_PATHS,
  readGeneratedBuildId,
  readGitBuildInfo,
  renderBuildGeneratedTypeScript,
  writeBuildGeneratedFiles
} from "../../scripts/version/lib.mts";

const SEMVER = "0.6.0-rc.18";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("PACK-12F.1 build provenance check contract", () => {
  it("self-reference trap: committed build.generated cannot equal post-commit HEAD", () => {
    // Simulate: generate for commit C, then HEAD advances to D without regenerating.
    const forCommitC = renderBuildGeneratedTypeScript({
      commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      dirty: false,
      buildId: `${SEMVER}@aaaaaaaaaaaa`
    });
    const forCommitD = renderBuildGeneratedTypeScript({
      commit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      dirty: false,
      buildId: `${SEMVER}@bbbbbbbbbbbb`
    });
    assert.notEqual(forCommitC, forCommitD);
    // Equality-only version:check against live HEAD would fail forever after any
    // commit that includes regenerated provenance for the previous HEAD.
  });

  it("refresh writes build twins to match computed HEAD provenance", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-build-prov-"));
    try {
      const src = path.join(dir, BUILD_GENERATED_PATHS.src);
      const desktop = path.join(dir, BUILD_GENERATED_PATHS.desktop);
      fs.mkdirSync(path.dirname(src), { recursive: true });
      fs.mkdirSync(path.dirname(desktop), { recursive: true });
      const stale = renderBuildGeneratedTypeScript({
        commit: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        dirty: true,
        buildId: `${SEMVER}@deadbeefdead+dirty`
      });
      fs.writeFileSync(src, stale, "utf8");
      fs.writeFileSync(desktop, stale, "utf8");

      const info = {
        commit: "cafebabecafebabecafebabecafebabecafebabe",
        dirty: false,
        buildId: `${SEMVER}@cafebabecafe`
      };
      writeBuildGeneratedFiles(dir, info);
      const expected = renderBuildGeneratedTypeScript(info);
      assert.equal(fs.readFileSync(src, "utf8"), expected);
      assert.equal(fs.readFileSync(desktop, "utf8"), expected);
      assert.equal(readGeneratedBuildId(src), info.buildId);
      assert.equal(readGeneratedBuildId(desktop), info.buildId);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("live readGitBuildInfo yields shaped buildId for current SemVer", () => {
    const info = readGitBuildInfo(ROOT, SEMVER);
    assert.match(info.buildId, new RegExp(`^${SEMVER.replace(/\./g, "\\.")}@[0-9a-f]{12}(\\+dirty)?$`));
    assert.match(info.commit, /^[0-9a-f]{40}$/);
  });
});
