/**
 * PACK-12G.1 — player-release qualification must build before full tests
 * (dist/** required on a clean runner). Do not silently restore test-before-build.
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

describe("PACK-12G.1 player-release / CI workflow order", () => {
  it("player-release builds before full tests", () => {
    const yaml = fs.readFileSync(PLAYER_RELEASE, "utf8");
    assertBuildBeforeFullTest("player-release.yml", yaml);
  });

  it("ci-main and ci-pr keep the same build-before-test contract", () => {
    assertBuildBeforeFullTest("ci-main.yml", fs.readFileSync(CI_MAIN, "utf8"));
    assertBuildBeforeFullTest("ci-pr.yml", fs.readFileSync(CI_PR, "utf8"));
  });

  it("player-release retains draft-only tag path and dispatch-without-release", () => {
    const yaml = fs.readFileSync(PLAYER_RELEASE, "utf8");
    assert.match(yaml, /draft:\s*true/);
    assert.match(yaml, /make_latest:\s*false/);
    assert.match(yaml, /if:\s*github\.ref_type\s*==\s*'tag'/);
    assert.match(yaml, /if:\s*github\.ref_type\s*!=\s*'tag'/);
    assert.match(yaml, /environment:\s*player-release/);
    assert.doesNotMatch(yaml, /draft:\s*false/);
  });

  it("PACK-12G: CI packaging paths force electron-builder --publish never", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const builder = pkg.scripts["desktop:package:builder"] ?? "";
    assert.match(builder, /electron-builder/);
    assert.match(builder, /--publish\s+never/);
    assert.doesNotMatch(builder, /--publish\s+(always|onTag|onTagOrDraft)/);

    // Workflows must go through pnpm desktop:package (inherits --publish never).
    for (const [label, file] of [
      ["player-release.yml", PLAYER_RELEASE],
      ["ci-main.yml", CI_MAIN],
      ["ci-pr.yml", CI_PR]
    ] as const) {
      const yaml = fs.readFileSync(file, "utf8");
      if (label === "ci-pr.yml") {
        // PR gate builds/tests only — no package step required.
        continue;
      }
      assert.match(yaml, /pnpm desktop:package\b/, `${label} must call desktop:package`);
      assert.doesNotMatch(
        yaml,
        /electron-builder(?![^\n]*--publish never)/,
        `${label} must not invoke electron-builder directly without publish never`
      );
    }

    const yml = fs.readFileSync(path.join(ROOT, "electron-builder.yml"), "utf8");
    assert.match(yml, /^publish:\s*null\s*$/m);
  });
});
