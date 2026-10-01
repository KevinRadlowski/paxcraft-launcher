/**
 * PACK-12G.1 / PACK-PAX-03.1 — validation workflows must build before full tests
 * (dist/** required on a clean runner). Do not silently restore test-before-build.
 *
 * Pax policy (PACK-PAX-03.1): CI validates without NSIS packaging / GitHub Release.
 * Product still forces `desktop:package:builder --publish never` and `publish: null`
 * for when packaging returns in a later lot.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PLAYER_RELEASE = path.join(ROOT, ".github", "workflows", "player-release.yml");
const CI_MAIN = path.join(ROOT, ".github", "workflows", "ci-main.yml");
const CI_PR = path.join(ROOT, ".github", "workflows", "ci-pr.yml");

/** Ordered step names matching `- name: …` lines in a workflow YAML body. */
function stepNames(yamlText: string): string[] {
  const names: string[] = [];
  for (const line of yamlText.split(/\r?\n/)) {
    const m = /^ {6}- name:\s*(.+)\s*$/.exec(line);
    if (m) names.push(m[1].trim());
  }
  return names;
}

function assertBuildBeforeFullTest(workflowLabel: string, yamlText: string): void {
  const names = stepNames(yamlText);
  const buildIdx = names.indexOf("Build");
  const testIdx = names.indexOf("Full test suite");
  assert.ok(buildIdx >= 0, `${workflowLabel}: missing step "Build"`);
  assert.ok(testIdx >= 0, `${workflowLabel}: missing step "Full test suite"`);
  assert.ok(
    buildIdx < testIdx,
    `${workflowLabel}: Build (index ${buildIdx}) must precede Full test suite (index ${testIdx})`
  );
}

function assertValidationOnlyPermissions(workflowLabel: string, yamlText: string): void {
  assert.match(yamlText, /permissions:\s*\r?\n\s*contents:\s*read/, `${workflowLabel}: contents: read`);
  assert.doesNotMatch(yamlText, /contents:\s*write/, `${workflowLabel}: must not request contents: write`);
  assert.doesNotMatch(yamlText, /id-token:\s*write/, `${workflowLabel}: no id-token write`);
}

describe("PACK-12G.1 player-release / CI workflow order", () => {
  it("player-release builds before full tests", () => {
    const yaml = fs.readFileSync(PLAYER_RELEASE, "utf8");
    assertBuildBeforeFullTest("player-release.yml", yaml);
  });

  it("ci-main and ci-pr keep the same build-before-test contract", () => {
    assertBuildBeforeFullTest("ci-main.yml", fs.readFileSync(CI_MAIN, "utf8"));
    assertBuildBeforeFullTest("ci-pr.yml", fs.readFileSync(CI_PR, "utf8"));
  });

  it("player-release is dispatch-only prep without auto-release publication", () => {
    const yaml = fs.readFileSync(PLAYER_RELEASE, "utf8");
    assert.match(yaml, /workflow_dispatch/);
    assert.match(yaml, /environment:\s*player-release/);
    assert.doesNotMatch(yaml, /softprops\/action-gh-release/);
    assert.doesNotMatch(yaml, /draft:\s*true/);
    assert.doesNotMatch(yaml, /make_latest:\s*true/);
    assert.doesNotMatch(yaml, /push:\s*\r?\n\s*tags:/);
    assertValidationOnlyPermissions("player-release.yml", yaml);
  });

  it("PACK-12G / PAX-03.1: product publish-never preserved; CI defers packaging", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const builder = pkg.scripts["desktop:package:builder"] ?? "";
    assert.match(builder, /electron-builder/);
    assert.match(builder, /--publish\s+never/);
    assert.doesNotMatch(builder, /--publish\s+(always|onTag|onTagOrDraft)/);

    const yml = fs.readFileSync(path.join(ROOT, "electron-builder.yml"), "utf8");
    assert.match(yml, /^publish:\s*null\s*$/m);

    // Provisional Pax CI: no workflow may run packaging/publish until a dedicated lot.
    for (const [label, file] of [
      ["player-release.yml", PLAYER_RELEASE],
      ["ci-main.yml", CI_MAIN],
      ["ci-pr.yml", CI_PR]
    ] as const) {
      const yaml = fs.readFileSync(file, "utf8");
      assertValidationOnlyPermissions(label, yaml);
      assert.doesNotMatch(yaml, /pnpm desktop:package\b/, `${label}: packaging deferred`);
      assert.doesNotMatch(yaml, /softprops\/action-gh-release/, `${label}: no GitHub Release`);
      assert.doesNotMatch(
        yaml,
        /electron-builder/,
        `${label}: must not invoke electron-builder directly`
      );
    }
  });
});
