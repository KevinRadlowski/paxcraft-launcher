/**
 * PACK-12B — unsigned player release manifest schema v1 (fail-closed qualification).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  ROOT,
  parseLauncherVersion,
  readGitBuildInfo,
  readRootPackageVersion
} from "../version/lib.mts";

export { ROOT };

export const RELEASE_MANIFEST_SCHEMA_VERSION = 1 as const;
export const RELEASE_PRODUCT_NAME = "SweetCraft Launcher";
export const RELEASE_PLATFORM = "win32" as const;
export const RELEASE_ARCH = "x64" as const;
export const RELEASE_SIGNING_STATUS = "unsigned" as const;

export type PlayerReleaseChannel = "rc" | "stable" | "internal";

export interface PlayerReleaseArtifactV1 {
  readonly filename: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface PlayerReleaseManifestV1 {
  readonly schemaVersion: typeof RELEASE_MANIFEST_SCHEMA_VERSION;
  readonly product: typeof RELEASE_PRODUCT_NAME;
  readonly semver: string;
  readonly windowsFileVersion: string;
  readonly buildCommit: string;
  readonly buildId: string;
  readonly dirty: false;
  readonly channel: PlayerReleaseChannel;
  readonly platform: typeof RELEASE_PLATFORM;
  readonly arch: typeof RELEASE_ARCH;
  readonly artifact: PlayerReleaseArtifactV1;
  readonly signing: { readonly status: typeof RELEASE_SIGNING_STATUS };
  readonly createdAt: string;
}

export interface ProvenanceOverride {
  readonly commit: string;
  readonly dirty: boolean;
  readonly buildId: string;
}

export interface BuildPlayerReleaseManifestOptions {
  readonly setupPath: string;
  readonly expectedCommit?: string;
  readonly expectedSemverFromTag?: string;
  readonly provenanceOverride?: ProvenanceOverride;
  readonly createdAt?: string;
  readonly root?: string;
}

export class ReleaseQualifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReleaseQualifyError";
  }
}

function fail(message: string): never {
  throw new ReleaseQualifyError(message);
}

export function expectedSetupFilename(semver: string): string {
  return `${RELEASE_PRODUCT_NAME}-${semver}-win-x64-setup.exe`;
}

export function distributionChannelFromSemver(semver: string): PlayerReleaseChannel {
  const info = parseLauncherVersion(semver);
  if (info.prereleasePhase === "rc") return "rc";
  if (info.prerelease === null) return "stable";
  return "internal";
}

export function isPrereleaseSemver(semver: string): boolean {
  return parseLauncherVersion(semver).prerelease !== null;
}

export function semverFromReleaseTag(tag: string): string {
  const stripped = tag.trim().replace(/^v/i, "");
  return parseLauncherVersion(stripped).semver;
}

export function isSha256Hex(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

export function sha256FileHex(filePath: string): string {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(64 * 1024);
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      hash.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

export function resolveDefaultSetupPath(root: string = ROOT): string {
  const semver = readRootPackageVersion(root);
  return path.join(root, "release", expectedSetupFilename(semver));
}

export function defaultManifestOutPath(setupPath: string): string {
  return path.join(path.dirname(path.resolve(setupPath)), "player-release-manifest-win-x64.json");
}

function isFullCommitSha(value: string): boolean {
  return /^[a-f0-9]{40}$/.test(value);
}

export function buildPlayerReleaseManifest(
  opts: BuildPlayerReleaseManifestOptions
): PlayerReleaseManifestV1 {
  const root = opts.root ?? ROOT;
  const setupPath = path.resolve(opts.setupPath);

  if (!fs.existsSync(setupPath) || !fs.statSync(setupPath).isFile()) {
    fail(`setup missing or not a file: ${setupPath}`);
  }

  const pkgSemver = readRootPackageVersion(root);
  const versionInfo = parseLauncherVersion(pkgSemver);
  const semver = versionInfo.semver;

  if (opts.expectedSemverFromTag !== undefined) {
    const fromTag = semverFromReleaseTag(opts.expectedSemverFromTag);
    if (fromTag !== semver) {
      fail(`SemVer/tag mismatch: tag=${fromTag} package.json=${semver}`);
    }
  }

  const filename = path.basename(setupPath);
  const expectedName = expectedSetupFilename(semver);
  if (filename !== expectedName) {
    fail(`setup filename mismatch: got ${JSON.stringify(filename)} expected ${JSON.stringify(expectedName)}`);
  }

  const sizeBytes = fs.statSync(setupPath).size;
  if (sizeBytes <= 0) {
    fail(`setup size must be > 0 (got ${sizeBytes})`);
  }

  const sha256 = sha256FileHex(setupPath);
  if (!isSha256Hex(sha256)) {
    fail(`setup SHA-256 malformed: ${JSON.stringify(sha256)}`);
  }

  const live = readGitBuildInfo(root, semver);
  const provenance = opts.provenanceOverride ?? live;
  const expectedCommit = (opts.expectedCommit ?? provenance.commit).toLowerCase();
  const buildCommit = provenance.commit.toLowerCase();

  if (provenance.dirty === true) {
    fail("dirty=true rejected: player releases require a clean worktree");
  }

  if (!isFullCommitSha(buildCommit)) {
    fail(`buildCommit must be a 40-char hex SHA (got ${JSON.stringify(provenance.commit)})`);
  }
  if (!isFullCommitSha(expectedCommit)) {
    fail(`expectedCommit must be a 40-char hex SHA (got ${JSON.stringify(opts.expectedCommit ?? provenance.commit)})`);
  }
  if (buildCommit !== expectedCommit) {
    fail(`buildCommit mismatch: manifest/provenance=${buildCommit} expected=${expectedCommit}`);
  }

  const expectedBuildId = `${semver}@${buildCommit.slice(0, 12)}`;
  if (provenance.buildId !== expectedBuildId) {
    fail(`buildId mismatch: got ${JSON.stringify(provenance.buildId)} expected ${JSON.stringify(expectedBuildId)}`);
  }

  const createdAt = opts.createdAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(createdAt))) {
    fail(`createdAt is not a valid ISO timestamp: ${JSON.stringify(createdAt)}`);
  }

  return {
    schemaVersion: RELEASE_MANIFEST_SCHEMA_VERSION,
    product: RELEASE_PRODUCT_NAME,
    semver,
    windowsFileVersion: versionInfo.windowsVersion,
    buildCommit,
    buildId: expectedBuildId,
    dirty: false,
    channel: distributionChannelFromSemver(semver),
    platform: RELEASE_PLATFORM,
    arch: RELEASE_ARCH,
    artifact: {
      filename,
      sizeBytes,
      sha256
    },
    signing: { status: RELEASE_SIGNING_STATUS },
    createdAt
  };
}

export function assertManifestMatchesSetup(
  manifest: PlayerReleaseManifestV1,
  setupPath: string
): void {
  const resolved = path.resolve(setupPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    fail(`setup missing for manifest assert: ${resolved}`);
  }
  const filename = path.basename(resolved);
  if (filename !== manifest.artifact.filename) {
    fail(`manifest filename ${JSON.stringify(manifest.artifact.filename)} != setup ${JSON.stringify(filename)}`);
  }
  const sizeBytes = fs.statSync(resolved).size;
  if (sizeBytes !== manifest.artifact.sizeBytes) {
    fail(`manifest sizeBytes ${manifest.artifact.sizeBytes} != setup ${sizeBytes}`);
  }
  const sha256 = sha256FileHex(resolved);
  if (sha256 !== manifest.artifact.sha256) {
    fail(`manifest sha256 ${manifest.artifact.sha256} != setup ${sha256}`);
  }
  if (manifest.signing.status !== RELEASE_SIGNING_STATUS) {
    fail(`signing.status must be ${RELEASE_SIGNING_STATUS}`);
  }
}

export function writePlayerReleaseManifest(
  manifest: PlayerReleaseManifestV1,
  outPath: string,
  setupPath?: string
): string {
  const resolvedOut = path.resolve(outPath);
  const setup = setupPath
    ?? path.join(path.dirname(resolvedOut), manifest.artifact.filename);
  assertManifestMatchesSetup(manifest, setup);
  fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
  fs.writeFileSync(resolvedOut, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return resolvedOut;
}
