/**
 * PACK-12B — static contract of the unsigned draft player-release workflow.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const YAML_PATH = path.join(ROOT, ".github", "workflows", "player-release.yml");

describe("PACK-12B player-release workflow", () => {
  const yaml = fs.readFileSync(YAML_PATH, "utf8");

  it("is draft-only and never auto-publishes latest", () => {
    assert.match(yaml, /draft:\s*true/);
    assert.doesNotMatch(yaml, /latest:\s*true/);
    assert.match(yaml, /softprops\/action-gh-release@v2/);
    assert.match(yaml, /Create draft GitHub Release/);
    assert.match(yaml, /name:\s*Player Release \(unsigned draft\)/);
  });

  it("has no signing / identity federation knobs", () => {
    assert.doesNotMatch(yaml, /id-token/);
    assert.doesNotMatch(yaml, /azure/i);
    assert.doesNotMatch(yaml, /OIDC/i);
    assert.doesNotMatch(yaml, /trusted-signing/i);
    assert.doesNotMatch(yaml, /CSC_/);
    assert.doesNotMatch(yaml, /signtool/i);
  });

  it("is not triggered by pull_request", () => {
    assert.doesNotMatch(yaml, /pull_request/);
    assert.match(yaml, /workflow_dispatch/);
    assert.match(yaml, /environment:\s*player-release/);
  });

  it("qualifies before creating a release and attaches setup + manifest", () => {
    const iCheck = yaml.indexOf("pnpm version:check");
    const iTest = yaml.indexOf("pnpm test");
    const iPkg = yaml.indexOf("pnpm desktop:package");
    const iManifest = yaml.indexOf("pnpm release:manifest");
    const iRelease = yaml.indexOf("softprops/action-gh-release");
    assert.ok(iCheck >= 0 && iTest >= 0 && iPkg >= 0 && iManifest >= 0 && iRelease >= 0);
    assert.ok(iCheck < iRelease, "version:check must precede release create");
    assert.ok(iTest < iRelease, "test must precede release create");
    assert.ok(iPkg < iRelease, "desktop:package must precede release create");
    assert.ok(iManifest < iRelease, "release:manifest must precede release create");
    assert.match(yaml, /SweetCraft Launcher-\*-win-x64-setup\.exe/);
    assert.match(yaml, /player-release-manifest-win-x64\.json/);
  });
});
