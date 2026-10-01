/**
 * Clears the unpackaged fake-install persistence directory marker file.
 * Never touches launcher-data / real instance / 0.5A transaction files.
 *
 * Usage: pnpm desktop:fake-install:reset
 * Optional: SWEETCRAFT_FAKE_INSTALL_DIR=/custom/path
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FAKE_INSTALL_STORE_FILENAME } from "../desktop/main/install/fake-install-store.js";

function defaultDir(): string {
  if (process.env.SWEETCRAFT_FAKE_INSTALL_DIR?.trim()) {
    return process.env.SWEETCRAFT_FAKE_INSTALL_DIR.trim();
  }
  const roaming =
    process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  // Electron unpackaged typically uses package.json "name".
  const candidates = [
    path.join(roaming, "sweetcraft-launcher", "dev-fake-install"),
    path.join(roaming, "PaxCraft Launcher", "dev-fake-install")
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, FAKE_INSTALL_STORE_FILENAME))) return c;
  }
  return candidates[0]!;
}

const dir = defaultDir();
const file = path.join(dir, FAKE_INSTALL_STORE_FILENAME);
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
