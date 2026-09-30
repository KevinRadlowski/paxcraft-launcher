/**
 * CLI play diagnostic echo — GAME_STDOUT/STDERR from already-sanitized runner lines.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { formatPlayCliDiagnosticLine } from "../../src/cli/play-cli-diagnostics.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("play CLI diagnostics (GAME_STDOUT / GAME_STDERR)", () => {
  it("A. PLAY_PROGRESS keeps prior [play] <phase> format", () => {
    assert.equal(
      formatPlayCliDiagnosticLine({ type: "PLAY_PROGRESS", data: { phase: "RUNNING" } }),
      "[play] RUNNING"
    );
    assert.equal(
      formatPlayCliDiagnosticLine({ type: "PLAY_PROGRESS", data: { phase: "STARTING_GAME" } }),
      "[play] STARTING_GAME"
    );
    assert.equal(formatPlayCliDiagnosticLine({ type: "PLAY_PROGRESS", data: {} }), "[play] ?");
    assert.equal(formatPlayCliDiagnosticLine({ type: "PLAY_PROGRESS" }), "[play] ?");
  });

  it("B. GAME_STDOUT echoes sanitized line only", () => {
    assert.equal(
      formatPlayCliDiagnosticLine({
        type: "GAME_STDOUT",
        data: { line: "Loading Minecraft 1.21" }
      }),
      "[minecraft] Loading Minecraft 1.21"
    );
  });

  it("C. GAME_STDERR echoes sanitized line only", () => {
    assert.equal(
      formatPlayCliDiagnosticLine({
        type: "GAME_STDERR",
        data: { line: "Exception in thread main" }
      }),
      "[minecraft:stderr] Exception in thread main"
    );
  });

  it("D. invalid / missing non-string line → null (no throw)", () => {
    assert.equal(formatPlayCliDiagnosticLine({ type: "GAME_STDOUT", data: {} }), null);
    assert.equal(formatPlayCliDiagnosticLine({ type: "GAME_STDOUT", data: { line: 42 } }), null);
    assert.equal(formatPlayCliDiagnosticLine({ type: "GAME_STDOUT", data: { line: null } }), null);
    assert.equal(formatPlayCliDiagnosticLine({ type: "GAME_STDERR", data: null }), null);
    assert.equal(formatPlayCliDiagnosticLine({ type: "GAME_STDERR" }), null);
    assert.equal(
      formatPlayCliDiagnosticLine({
        type: "GAME_STDOUT",
        data: { line: ["array"] }
      }),
      null
    );
  });

  it("E. formatter never reads token/argv/env/command/secrets from event data", () => {
    const src = readFileSync(path.join(ROOT, "src/cli/play-cli-diagnostics.ts"), "utf8");
    // Only `line` (and PLAY_PROGRESS `phase`) are accessed — no secret-bearing keys.
    assert.doesNotMatch(src, /\.token\b|\.argv\b|\.env\b|\.command\b|\.secrets\b|accessToken|refreshToken/i);
    assert.match(src, /extractSanitizedLine/);
    assert.match(src, /"line"/);

    // Even if a hostile payload includes secrets, output uses only `line`.
    const out = formatPlayCliDiagnosticLine({
      type: "GAME_STDOUT",
      data: {
        line: "safe-only",
        token: "leak",
        argv: ["java", "-cp", "secret"],
        env: { ACCESS_TOKEN: "x" },
        command: "java -jar",
        secrets: ["x"]
      }
    });
    assert.equal(out, "[minecraft] safe-only");
    assert.ok(out !== null && !out.includes("leak"));
    assert.ok(!out.includes("ACCESS_TOKEN"));
    assert.ok(!out.includes("java -jar"));
  });

  it("F. ignores unrelated event types", () => {
    assert.equal(
      formatPlayCliDiagnosticLine({ type: "GAME_PROCESS_STARTED", data: { pid: 1 } }),
      null
    );
    assert.equal(formatPlayCliDiagnosticLine({ type: "DOWNLOAD_PROGRESS", data: {} }), null);
  });

  it("CLI main wires formatPlayCliDiagnosticLine for play emitter", () => {
    const mainSrc = readFileSync(path.join(ROOT, "src/cli/main.ts"), "utf8");
    assert.match(mainSrc, /formatPlayCliDiagnosticLine/);
    assert.match(mainSrc, /play-cli-diagnostics/);
  });

  it("src/launch/** remains out of this micro-lot (no CLI import of sanitize)", () => {
    const diag = readFileSync(path.join(ROOT, "src/cli/play-cli-diagnostics.ts"), "utf8");
    assert.doesNotMatch(diag, /from\s+["'][^"']*launch[^"']*["']/);
    assert.doesNotMatch(diag, /import\s*\{[^}]*sanitizeProcessOutputLine/);
  });
});
