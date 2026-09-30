/**
 * PACK-12D — source-level upgrade / uninstall contract invariants (safe, no live install).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const yml = readFileSync(path.join(root, "electron-builder.yml"), "utf8");
const playerInstall = readFileSync(path.join(root, "docs/PLAYER_INSTALL.md"), "utf8");
const safeDiag = readFileSync(
  path.join(root, "desktop/main/diagnostics/safe-diagnostics.ts"),
  "utf8"
);
const lifecycle = readFileSync(path.join(root, "desktop/main/lifecycle.ts"), "utf8");

describe("PACK-12D upgrade/uninstall source contracts", () => {
  it("NSIS preserves AppData on uninstall", () => {
    assert.match(yml, /deleteAppDataOnUninstall:\s*false/);
    assert.match(yml, /appId:\s*fr\.xbase\.sweetcraft\.launcher/);
    assert.match(yml, /productName:\s*SweetCraft Launcher/);
  });

  it("PLAYER_INSTALL distinguishes launcher vs pack update and documents preserve contract", () => {
    assert.match(playerInstall, /Mise à jour du \*\*Launcher\*\*/);
    assert.match(playerInstall, /Mise à jour du \*\*pack/);
    assert.match(playerInstall, /deleteAppDataOnUninstall:\s*false/);
    assert.match(playerInstall, /downgrade/i);
    assert.match(playerInstall, /SAFE/);
    assert.match(playerInstall, /COMPLETE/);
    assert.match(playerInstall, /pas\*?\*? de mise à jour automatique/i);
  });

  it("diagnostics provenance reuses AppInfo buildId/buildCommit — no second metadata source", () => {
    assert.match(safeDiag, /optionalBuildId\(info\?\.buildId\)/);
    assert.match(safeDiag, /optionalBuildCommit\(info\?\.buildCommit\)/);
    assert.match(lifecycle, /buildId:\s*LAUNCHER_BUILD_ID/);
    assert.match(lifecycle, /buildCommit:\s*LAUNCHER_BUILD_COMMIT/);
    assert.match(lifecycle, /info:\s*getAppInfo\(mode\)/);
  });
});
