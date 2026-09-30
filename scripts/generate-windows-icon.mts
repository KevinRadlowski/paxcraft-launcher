/**
 * Generate Windows multi-size icon.ico from build/icon-source.svg.
 * Source branding: ui/src/assets/branding/logo.svg (SweetCraft mark).
 *
 * Usage: pnpm exec tsx scripts/generate-windows-icon.mts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import toIco from "to-ico";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "build", "icon-source.svg");
const OUT_ICO = join(ROOT, "build", "icon.ico");
const OUT_PNG = join(ROOT, "build", "icon.png");

/** Standard Windows icon sizes (electron-builder / shell). */
const SIZES = [16, 24, 32, 48, 64, 128, 256] as const;

async function main(): Promise<void> {
  mkdirSync(dirname(OUT_ICO), { recursive: true });
  const svg = readFileSync(SOURCE);

  const pngs: Buffer[] = [];
  for (const size of SIZES) {
    const resvg = new Resvg(svg, {
      fitTo: { mode: "width", value: size },
      background: "transparent",
    });
    pngs.push(Buffer.from(resvg.render().asPng()));
  }

  // Master PNG (256) for electron-builder fallback / tooling.
  writeFileSync(OUT_PNG, pngs[pngs.length - 1]!);
  writeFileSync(OUT_ICO, await toIco(pngs));

  console.log(`Wrote ${OUT_ICO}`);
  console.log(`Wrote ${OUT_PNG} (256px)`);
  console.log(`Sizes: ${SIZES.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
