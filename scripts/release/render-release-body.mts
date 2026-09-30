/**
 * pnpm release:body — French GitHub Release notes from the player manifest.
 *
 * Usage: pnpm release:body -- --manifest <json> [--out <md>] [--install-doc <path-or-url>]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ROOT,
  ReleaseQualifyError,
  type PlayerReleaseChannel,
  type PlayerReleaseManifestV1
} from "./manifest.mts";

const DEFAULT_TEMPLATE = path.join(ROOT, "docs", "release", "RELEASE_BODY.template.md");
const DEFAULT_INSTALL_DOC = "docs/PLAYER_INSTALL.md";

function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  if (!v || v.startsWith("--")) {
    throw new ReleaseQualifyError(`missing value for ${flag}`);
  }
  return v;
}

function channelNote(channel: PlayerReleaseChannel): string {
  if (channel === "stable") {
    return "Ceci est une version **stable** destinée aux joueurs. Installez uniquement depuis la page GitHub Releases officielle.";
  }
  if (channel === "rc") {
    return "Ceci est une **release candidate (RC)** : build de prévisualisation pour tests joueurs, pas encore la version stable finale.";
  }
  return "Ceci est un build **interne**. Il n’est pas destiné à une distribution joueur générale.";
}

function installDocHref(manifest: PlayerReleaseManifestV1, installDoc: string): string {
  if (/^https?:\/\//i.test(installDoc)) return installDoc;
  const repo = process.env.GITHUB_REPOSITORY;
  if (repo) {
    return `https://github.com/${repo}/blob/${manifest.buildCommit}/${installDoc.replace(/\\/g, "/")}`;
  }
  return installDoc.replace(/\\/g, "/");
}

export function renderPlayerReleaseBody(
  manifest: PlayerReleaseManifestV1,
  options?: { templatePath?: string; installDoc?: string }
): string {
  const templatePath = options?.templatePath ?? DEFAULT_TEMPLATE;
  if (!fs.existsSync(templatePath)) {
    throw new ReleaseQualifyError(`release body template missing: ${templatePath}`);
  }
  const installDoc = options?.installDoc ?? DEFAULT_INSTALL_DOC;
  const replacements: Record<string, string> = {
    "{{SEMVER}}": manifest.semver,
    "{{BUILD_ID}}": manifest.buildId,
    "{{BUILD_COMMIT}}": manifest.buildCommit,
    "{{SETUP_FILENAME}}": manifest.artifact.filename,
    "{{SHA256}}": manifest.artifact.sha256,
    "{{SIZE_BYTES}}": String(manifest.artifact.sizeBytes),
    "{{CHANNEL}}": manifest.channel,
    "{{CREATED_AT}}": manifest.createdAt,
    "{{CHANNEL_NOTE}}": channelNote(manifest.channel),
    "{{INSTALL_DOC}}": installDocHref(manifest, installDoc)
  };
  let body = fs.readFileSync(templatePath, "utf8");
  for (const [token, value] of Object.entries(replacements)) {
    body = body.split(token).join(value);
  }
  return body;
}

export function main(argv: string[] = process.argv.slice(2)): number {
  try {
    const manifestPath = argValue(argv, "--manifest");
    if (!manifestPath) {
      throw new ReleaseQualifyError("--manifest is required");
    }
    const outPath = argValue(argv, "--out");
    const installDoc = argValue(argv, "--install-doc");
    const raw = fs.readFileSync(path.resolve(manifestPath), "utf8");
    const manifest = JSON.parse(raw) as PlayerReleaseManifestV1;
    const body = renderPlayerReleaseBody(manifest, { installDoc });
    if (outPath) {
      const resolved = path.resolve(outPath);
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, body, "utf8");
      console.log(`release:body OK ${resolved}`);
    } else {
      process.stdout.write(body);
    }
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const name = e instanceof Error ? e.name : "Error";
    console.error(`release:body FAIL: ${name}: ${msg}`);
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
