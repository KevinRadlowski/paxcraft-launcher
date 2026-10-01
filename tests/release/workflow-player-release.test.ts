/**
 * PACK-12B / PACK-PAX-03.1 — static contract of player-release.yml
 * (Pax provisional: manual qualification prep, no GitHub Release / no NSIS).
 *
 * Policy change vs SweetCraft PACK-12B draft-release expectations:
 * - KEEP: path `.github/workflows/player-release.yml`, workflow_dispatch, no PR trigger,
 *   no signing/OIDC knobs, qualification order version:check → build → tests,
 *   environment gate name `player-release`.
 * - REPLACE: draft softprops GitHub Release + desktop:package + setup artifact attach
 *   → assert absence of publication/packaging steps until a dedicated Pax release lot.
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

  it("is manual qualification prep and never publishes a GitHub Release", () => {
    assert.match(yaml, /name:\s*Player Qualification \(prep, no release\)/);
    assert.doesNotMatch(yaml, /softprops\/action-gh-release/);
    assert.doesNotMatch(yaml, /Create draft GitHub Release/);
    assert.doesNotMatch(yaml, /draft:\s*true/);
    assert.doesNotMatch(yaml, /make_latest:\s*true/);
    assert.doesNotMatch(yaml, /latest:\s*true/);
    assert.doesNotMatch(yaml, /contents:\s*write/);
  });

  it("has no signing / identity federation knobs", () => {
    assert.doesNotMatch(yaml, /id-token/);
    assert.doesNotMatch(yaml, /azure/i);
    assert.doesNotMatch(yaml, /OIDC/i);
    assert.doesNotMatch(yaml, /trusted-signing/i);
    assert.doesNotMatch(yaml, /CSC_/);
    assert.doesNotMatch(yaml, /signtool/i);
  });

  it("is not triggered by pull_request or tag push; dispatch only", () => {
    assert.doesNotMatch(yaml, /pull_request/);
    assert.match(yaml, /workflow_dispatch/);
    assert.doesNotMatch(yaml, /push:\s*\r?\n\s*tags:/);
    assert.match(yaml, /environment:\s*player-release/);
  });

  it("qualifies with version/build/test and defers packaging/release", () => {
    const iCheck = yaml.indexOf("pnpm version:check");
    const iBuild = yaml.indexOf("pnpm build");
    const iTest = yaml.indexOf("pnpm test");
    assert.ok(iCheck >= 0 && iBuild >= 0 && iTest >= 0);
    assert.ok(iCheck < iBuild, "version:check must precede build");
    assert.ok(iBuild < iTest, "build must precede test");
    assert.doesNotMatch(yaml, /pnpm desktop:package\b/);
    assert.doesNotMatch(yaml, /desktop:package:renderer-smoke/);
    assert.doesNotMatch(yaml, /pnpm release:manifest/);
    assert.doesNotMatch(yaml, /electron-builder/);
    assert.match(yaml, /permissions:\s*\r?\n\s*contents:\s*read/);
  });
});