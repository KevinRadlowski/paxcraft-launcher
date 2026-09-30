/**
 * PACK-10.1SYNC-12D — static checks for E2E fresh-firstrun verifier helpers.
 */
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { encodeServersDat } from "../../src/instance/firstRun/serversDat.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HELPER = path.join(REPO_ROOT, "scripts/e2e/parse-servers-check.mjs");
const PS1 = path.join(REPO_ROOT, "scripts/e2e/verify-fresh-firstrun.ps1");

describe("e2e parse-servers-check helper", () => {
  it("resolves dist module from repo (not TEMP) and detects SweetCraft", async () => {
    await access(path.join(REPO_ROOT, "dist/instance/firstRun/serversDat.js"));
    const dir = await mkdtemp(path.join(tmpdir(), "sc-verify-srv-"));
    const serversPath = path.join(dir, "servers.dat");
    await writeFile(
      serversPath,
      encodeServersDat([{ name: "SweetCraft", ip: "sweetcraft.datho.st" }])
    );
    const r = spawnSync(process.execPath, [HELPER, serversPath], {
      encoding: "utf8",
      cwd: tmpdir() // intentional: helper must not depend on cwd for dist import
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const payload = JSON.parse(r.stdout.trim());
    assert.equal(payload.hasAddress, true);
    assert.match(payload.moduleAbs.replace(/\\/g, "/"), /dist\/instance\/firstRun\/serversDat\.js$/);
    assert.ok(!payload.moduleAbs.toLowerCase().includes("temp"), payload.moduleAbs);
  });

  it("exit 2 when SweetCraft address absent", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sc-verify-nosrv-"));
    const serversPath = path.join(dir, "servers.dat");
    await writeFile(serversPath, encodeServersDat([{ name: "Other", ip: "example.com" }]));
    const r = spawnSync(process.execPath, [HELPER, serversPath], {
      encoding: "utf8",
      cwd: tmpdir()
    });
    assert.equal(r.status, 2);
    const payload = JSON.parse((r.stderr || r.stdout).trim());
    assert.equal(payload.kind, "sweetcraft_entry_absent");
  });

  it("exit 3 on invalid NBT", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sc-verify-bad-"));
    const serversPath = path.join(dir, "servers.dat");
    await writeFile(serversPath, Buffer.from([0x0a, 0x00, 0x00, 0x09]));
    const r = spawnSync(process.execPath, [HELPER, serversPath], {
      encoding: "utf8",
      cwd: tmpdir()
    });
    assert.equal(r.status, 3);
    const payload = JSON.parse((r.stderr || r.stdout).trim());
    assert.equal(payload.kind, "servers_dat_invalid");
  });
});

describe("e2e verify-fresh-firstrun.ps1 source contracts", () => {
  it("resolves RepoRoot in body and refuses legacy path", async () => {
    const src = await readFile(PS1, "utf8");
    assert.match(src, /\$RepoRoot\s*=\s*\[System\.IO\.Path\]::GetFullPath/);
    assert.match(src, /parse-servers-check\.mjs/);
    assert.match(src, /E:\\Jeux\\SweetCraft/);
    assert.match(src, /VERIFIER_TOOL_FAILURE/);
    assert.match(src, /SWEETCRAFT_SERVER_ABSENT/);
    assert.match(src, /SERVERS_DAT_INVALID/);
    assert.doesNotMatch(src, /\$RepoRoot\s*=\s*\(Resolve-Path/);
  });
});
