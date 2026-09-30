/**
 * Clears the unpackaged fake-auth persistence directory marker file.
 * Never touches launcher-data / DPAPI / AccountRegistry.
 *
 * Usage: pnpm desktop:fake-auth:reset
 * Optional: SWEETCRAFT_FAKE_AUTH_DIR=/custom/path
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FAKE_AUTH_STORE_FILENAME } from "../desktop/main/auth/fake-auth-store.js";

function defaultDir(): string {
  if (process.env.SWEETCRAFT_FAKE_AUTH_DIR?.trim()) {
    return process.env.SWEETCRAFT_FAKE_AUTH_DIR.trim();
  }
  const roaming =
    process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  // Electron unpackaged typically uses package.json "name".
  const candidates = [
    path.join(roaming, "sweetcraft-launcher", "dev-fake-auth"),
    path.join(roaming, "SweetCraft Launcher", "dev-fake-auth")
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, FAKE_AUTH_STORE_FILENAME))) return c;
  }
  return candidates[0]!;
}

const dir = defaultDir();
const file = path.join(dir, FAKE_AUTH_STORE_FILENAME);
try {
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    console.log(`Removed ${file}`);
  } else {
    console.log(`No fake store at ${file}`);
  }
} catch (e) {
  console.error(e);
  process.exit(1);
}
