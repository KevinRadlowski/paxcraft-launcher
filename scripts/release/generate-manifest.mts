/**
 * pnpm release:manifest — qualify unsigned Windows setup and write player-release-manifest-win-x64.json
 *
 * Usage: pnpm release:manifest -- [--setup <exe>] [--commit <sha>] [--tag <vX.Y.Z>] [--out <json>]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ReleaseQualifyError,
  buildPlayerReleaseManifest,
  defaultManifestOutPath,
  resolveDefaultSetupPath,
  writePlayerReleaseManifest
} from "./manifest.mts";

function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  if (!v || v.startsWith("--")) {
    throw new ReleaseQualifyError(`missing value for ${flag}`);
  }
  return v;
}

export function parseGenerateManifestArgs(argv: string[]): {
  setup?: string;
  commit?: string;
  tag?: string;
  out?: string;
} {
  return {
    setup: argValue(argv, "--setup"),
    commit: argValue(argv, "--commit"),
    tag: argValue(argv, "--tag"),
    out: argValue(argv, "--out")
  };
}

export function main(argv: string[] = process.argv.slice(2)): number {
  try {
    const args = parseGenerateManifestArgs(argv);
    const setupPath = args.setup ? path.resolve(args.setup) : resolveDefaultSetupPath();
    const manifest = buildPlayerReleaseManifest({
      setupPath,
      expectedCommit: args.commit,
      expectedSemverFromTag: args.tag
    });
    const outPath = args.out ? path.resolve(args.out) : defaultManifestOutPath(setupPath);
    writePlayerReleaseManifest(manifest, outPath, setupPath);
    console.log(`release:manifest OK ${outPath}`);
    console.log(`  semver=${manifest.semver} channel=${manifest.channel} buildId=${manifest.buildId}`);
    console.log(`  artifact=${manifest.artifact.filename}`);
    console.log(`  sha256=${manifest.artifact.sha256}`);
    console.log(`  sizeBytes=${manifest.artifact.sizeBytes}`);
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const name = e instanceof Error ? e.name : "Error";
    console.error(`release:manifest FAIL: ${name}: ${msg}`);
    return 1;
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  return path.normalize(path.resolve(entry)).toLowerCase() === path.normalize(self).toLowerCase();
}

if (isDirectRun()) {
  const code = main();
  if (code !== 0) process.exit(code);
}
