/**
 * Clears the unpackaged fake-play persistence directory marker file.
 * Never touches launcher-data / real instance / 0.5B transaction files.
 *
 * Usage: pnpm desktop:fake-play:reset
 * Optional: SWEETCRAFT_FAKE_PLAY_DIR=/custom/path
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FAKE_PLAY_STORE_FILENAME } from "../desktop/main/play/fake-play-store.js";

function defaultDir(): string {
  if (process.env.SWEETCRAFT_FAKE_PLAY_DIR?.trim()) {
    return process.env.SWEETCRAFT_FAKE_PLAY_DIR.trim();
  }
  const roaming =
    process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  // Electron unpackaged typically uses package.json "name".
  const candidates = [
    path.join(roaming, "sweetcraft-launcher", "dev-fake-play"),
    path.join(roaming, "SweetCraft Launcher", "dev-fake-play")
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, FAKE_PLAY_STORE_FILENAME))) return c;
  }
  return candidates[0]!;
}

const dir = defaultDir();
const file = path.join(dir, FAKE_PLAY_STORE_FILENAME);
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
