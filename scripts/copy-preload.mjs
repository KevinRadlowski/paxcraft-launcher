import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destDir = path.join(root, "dist-desktop", "preload");
mkdirSync(destDir, { recursive: true });
copyFileSync(
  path.join(root, "desktop", "preload", "preload.cjs"),
  path.join(destDir, "preload.cjs")
);
console.log("copied preload → dist-desktop/preload/preload.cjs");
