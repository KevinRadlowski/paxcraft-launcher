#!/usr/bin/env node
/**
 * PACK-10.1SYNC-12D — servers.dat SweetCraft check for E2E verifier.
 * Resolves the repo dist module via this file's location (never %TEMP% relative).
 *
 * Usage: node scripts/e2e/parse-servers-check.mjs <absolute-path-to-servers.dat>
 *
 * Exit codes:
 *   0 — SweetCraft address present
 *   2 — servers.dat parsed OK but SweetCraft / sweetcraft.datho.st absent
 *   3 — servers.dat missing / unreadable / invalid NBT
 *   4 — verifier/tool failure (built module missing, import error, bad args)
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const MODULE_ABS = path.join(REPO_ROOT, "dist", "instance", "firstRun", "serversDat.js");
const EXPECTED_IP = "sweetcraft.datho.st";

function failTool(message, detail) {
  console.error(JSON.stringify({ kind: "verifier_tool_failure", message, detail, moduleAbs: MODULE_ABS }));
  process.exit(4);
}

function failServers(message, detail) {
  console.error(JSON.stringify({ kind: "servers_dat_invalid", message, detail }));
  process.exit(3);
}

function failAbsent(payload) {
  console.error(JSON.stringify({ ...payload, kind: "sweetcraft_entry_absent" }));
  process.exit(2);
}

const serversPath = process.argv[2];
if (!serversPath || typeof serversPath !== "string") {
  failTool("missing servers.dat path argument");
}

if (!existsSync(MODULE_ABS)) {
  failTool("built serversDat module missing — run pnpm build", MODULE_ABS);
}

let parseServersDat;
try {
  const mod = await import(pathToFileURL(MODULE_ABS).href);
  parseServersDat = mod.parseServersDat;
  if (typeof parseServersDat !== "function") {
    failTool("parseServersDat export missing from module");
  }
} catch (e) {
  failTool("failed to import serversDat module", e instanceof Error ? e.message : String(e));
}

let buf;
try {
  buf = readFileSync(serversPath);
} catch (e) {
  const err = e;
  failServers("failed to read servers.dat", {
    path: serversPath,
    code: err && err.code,
    message: err instanceof Error ? err.message : String(err)
  });
}

let servers;
try {
  servers = parseServersDat(buf);
} catch (e) {
  failServers("invalid or unsupported servers.dat NBT", e instanceof Error ? e.message : String(e));
}

const ips = servers.map(s => String(s.ip));
const hasAddress = servers.some(s => String(s.ip).toLowerCase() === EXPECTED_IP);
const hasNamedSweetCraft = servers.some(
  s => String(s.name) === "SweetCraft" && String(s.ip).toLowerCase() === EXPECTED_IP
);

const payload = {
  kind: "ok",
  count: servers.length,
  hasAddress,
  hasNamedSweetCraft,
  ips,
  moduleAbs: MODULE_ABS
};

if (!hasAddress) {
  failAbsent(payload);
}

console.log(JSON.stringify(payload));
process.exit(0);
