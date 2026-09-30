/**
 * Resets all unpackaged fake harness stores (auth + install + play).
 * Composes the three existing isolated reset scripts.
 *
 * Usage: pnpm desktop:fake-reset
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scripts = ["reset-fake-auth.mts", "reset-fake-install.mts", "reset-fake-play.mts"];

let failed = false;
for (const script of scripts) {
  const file = path.join(root, "scripts", script);
  const result = spawnSync(process.execPath, ["--import", "tsx", file], {
    cwd: root,
    stdio: "inherit",
    env: process.env
  });
  if (result.status !== 0) {
    failed = true;
    console.error(`Failed: ${script}`);
  }
}

if (failed) {
  process.exit(1);
}
console.log("desktop:fake-reset complete");
