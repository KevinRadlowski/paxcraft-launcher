/**
 * Shared Launcher version model (PACK-09).
 * Canonical human source: root package.json "version".
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import semver from "semver";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Recognized prerelease phase labels mappable to Windows PE 4th component. */
export const WINDOWS_PRERELEASE_PHASES = ["rc", "beta", "alpha"] as const;
export type WindowsPrereleasePhase = (typeof WINDOWS_PRERELEASE_PHASES)[number];

/**
 * alpha.N / beta.N / rc.N with the same N all map to X.Y.Z.N.
 * Distribution identity remains the SemVer string (artifact name / tags).
 * Release process must not reuse N across phases for the same X.Y.Z
 * if PE numeric uniqueness is required.
 */
export const WINDOWS_PRERELEASE_MAPPING_POLICY = "PHASE_BLIND_NUMERIC_N" as const;

/** PE FILEVERSION / PRODUCTVERSION component max (16-bit). */
export const WINDOWS_VERSION_COMPONENT_MAX = 65535;

export interface LauncherVersionInfo {
  readonly semver: string;
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: string | null;
  readonly prereleasePhase: WindowsPrereleasePhase | null;
  readonly prereleaseNumber: number | null;
  readonly windowsVersion: string;
  readonly windowsParts: readonly [number, number, number, number];
}

export class VersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VersionError";
  }
}

export function readRootPackageVersion(root: string = ROOT): string {
  const pkgPath = path.join(root, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: unknown };
  if (typeof pkg.version !== "string" || !pkg.version.trim()) {
    throw new VersionError("root package.json missing string version");
  }
  return pkg.version.trim();
}

export function parseLauncherVersion(raw: string): LauncherVersionInfo {
  const cleaned = raw.trim();
  const parsed = semver.parse(cleaned, { loose: false });
  if (!parsed) {
    throw new VersionError(`invalid SemVer: ${JSON.stringify(raw)}`);
  }
  if (parsed.major > WINDOWS_VERSION_COMPONENT_MAX ||
      parsed.minor > WINDOWS_VERSION_COMPONENT_MAX ||
      parsed.patch > WINDOWS_VERSION_COMPONENT_MAX) {
    throw new VersionError(
      `SemVer core exceeds Windows PE component max ${WINDOWS_VERSION_COMPONENT_MAX}: ${cleaned}`
    );
  }

  let prereleasePhase: WindowsPrereleasePhase | null = null;
  let prereleaseNumber: number | null = null;
  let fourth = 0;

  if (parsed.prerelease.length === 0) {
    fourth = 0;
  } else if (
    parsed.prerelease.length === 2 &&
    typeof parsed.prerelease[0] === "string" &&
    typeof parsed.prerelease[1] === "number"
  ) {
    const phase = parsed.prerelease[0];
    const n = parsed.prerelease[1];
    if (!(WINDOWS_PRERELEASE_PHASES as readonly string[]).includes(phase)) {
      throw new VersionError(
        `unsupported prerelease phase ${JSON.stringify(phase)} (allowed: ${WINDOWS_PRERELEASE_PHASES.join(", ")})`
      );
    }
    if (!Number.isInteger(n) || n < 0) {
      throw new VersionError(`prerelease number must be a non-negative integer: ${cleaned}`);
    }
    if (n > WINDOWS_VERSION_COMPONENT_MAX) {
      throw new VersionError(
        `prerelease number ${n} exceeds Windows PE component max ${WINDOWS_VERSION_COMPONENT_MAX}`
      );
    }
    prereleasePhase = phase as WindowsPrereleasePhase;
    prereleaseNumber = n;
    fourth = n;
  } else {
    throw new VersionError(
      `unsupported prerelease format for Windows mapping: ${cleaned} (expected X.Y.Z or X.Y.Z-(rc|beta|alpha).N)`
    );
  }

  const windowsParts = [parsed.major, parsed.minor, parsed.patch, fourth] as const;
  const windowsVersion = windowsParts.join(".");

  return {
    semver: parsed.version,
    major: parsed.major,
    minor: parsed.minor,
    patch: parsed.patch,
    prerelease: parsed.prerelease.length ? parsed.prerelease.join(".") : null,
    prereleasePhase,
    prereleaseNumber,
    windowsVersion,
    windowsParts
  };
}

export function renderGeneratedTypeScript(info: LauncherVersionInfo): string {
  return `/* eslint-disable */
/**
 * DO NOT EDIT - generated from root package.json "version" by pnpm version:generate
 * Canonical SemVer source: package.json
 * Windows mapping policy: ${WINDOWS_PRERELEASE_MAPPING_POLICY}
 */
export const LAUNCHER_VERSION = ${JSON.stringify(info.semver)} as const;
export const WINDOWS_FILE_VERSION = ${JSON.stringify(info.windowsVersion)} as const;
export const LAUNCHER_VERSION_MAJOR = ${info.major} as const;
export const LAUNCHER_VERSION_MINOR = ${info.minor} as const;
export const LAUNCHER_VERSION_PATCH = ${info.patch} as const;
export const LAUNCHER_PRERELEASE = ${JSON.stringify(info.prerelease)} as const;
export const LAUNCHER_PRERELEASE_PHASE = ${JSON.stringify(info.prereleasePhase)} as const;
export const LAUNCHER_PRERELEASE_NUMBER = ${JSON.stringify(info.prereleaseNumber)} as const;
export const WINDOWS_PRERELEASE_MAPPING_POLICY = ${JSON.stringify(WINDOWS_PRERELEASE_MAPPING_POLICY)} as const;
`;
}

export const GENERATED_PATHS = {
  src: "src/version.generated.ts",
  desktop: "desktop/shared/version.generated.ts"
} as const;

export const BUILD_GENERATED_PATHS = {
  src: "src/build.generated.ts",
  desktop: "desktop/shared/build.generated.ts"
} as const;

export interface LauncherBuildInfo {
  readonly commit: string;
  readonly dirty: boolean;
  readonly buildId: string;
}

/**
 * Normalize a repo-relative path for policy matching (POSIX separators, no `./`).
 * Safe for Windows porcelain paths that may use `\`.
 */
export function normalizeRepoRelPath(relPath: string): string {
  return relPath
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/{2,}/g, "/");
}

/**
 * Declared local audit evidence — not a product/build input.
 * Narrow: `docs/audits/**` only (not broad `docs/**`).
 */
export function isNonProductAuditPath(relPath: string): boolean {
  const n = normalizeRepoRelPath(relPath);
  return n === "docs/audits" || n.startsWith("docs/audits/");
}

/** Canonical `version:generate` outputs — refreshed every build; not product inputs. */
export function isVersionGenerateOutputPath(relPath: string): boolean {
  const n = normalizeRepoRelPath(relPath);
  const outputs = new Set<string>([
    ...Object.values(GENERATED_PATHS),
    ...Object.values(BUILD_GENERATED_PATHS)
  ]);
  return outputs.has(n);
}

/**
 * Paths that do not make build provenance dirty even when present in porcelain.
 * Product-affecting tracked/untracked changes outside this set remain dirty.
 */
export function isBuildProvenanceIgnoredPath(relPath: string): boolean {
  return isNonProductAuditPath(relPath) || isVersionGenerateOutputPath(relPath);
}

export interface ParsedPorcelainEntry {
  readonly xy: string;
  readonly paths: readonly string[];
}

/**
 * Parse one `git status --porcelain` v1 line into status + normalized paths.
 * Supports rename/copy (`XY old -> new`) and simple quoted paths.
 */
export function parseGitPorcelainLine(line: string): ParsedPorcelainEntry | null {
  const raw = line.replace(/\r$/, "");
  if (!raw) return null;
  if (raw.length < 3) return null;
  const xy = raw.slice(0, 2);
  let rest = raw.slice(3);
  if (rest.startsWith("\"") && rest.endsWith("\"") && !rest.includes(" -> ")) {
    rest = rest.slice(1, -1).replace(/\\([\\\"ntr])/g, (_, c: string) => {
      if (c === "n") return "\n";
      if (c === "t") return "\t";
      if (c === "r") return "\r";
      return c;
    });
  }
  if (rest.includes(" -> ")) {
    const [a, b] = rest.split(" -> ");
    return {
      xy,
      paths: [normalizeRepoRelPath(stripPorcelainQuotes(a ?? "")), normalizeRepoRelPath(stripPorcelainQuotes(b ?? ""))]
    };
  }
  return { xy, paths: [normalizeRepoRelPath(stripPorcelainQuotes(rest))] };
}

function stripPorcelainQuotes(p: string): string {
  const t = p.trim();
  if (t.startsWith("\"") && t.endsWith("\"") && t.length >= 2) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * True when a porcelain entry affects product/build reproducibility.
 * - Tracked modify/delete/rename/etc. → dirty unless every path is provenance-ignored.
 * - Untracked (`??`) → dirty unless every path is provenance-ignored.
 * - Does not globally ignore untracked files.
 */
export function isProductAffectingPorcelainEntry(entry: ParsedPorcelainEntry): boolean {
  if (entry.paths.length === 0) return true;
  return entry.paths.some(p => !isBuildProvenanceIgnoredPath(p));
}

/** Classify full porcelain stdout for build dirty-state (deterministic, testable). */
export function isWorktreeProductDirtyFromPorcelain(porcelain: string): boolean {
  const lines = porcelain.split(/\n/).map(l => l.replace(/\r$/, "")).filter(l => l.length > 0);
  for (const line of lines) {
    const entry = parseGitPorcelainLine(line);
    if (!entry) continue;
    if (isProductAffectingPorcelainEntry(entry)) return true;
  }
  return false;
}

export function writeGeneratedFiles(root: string, info: LauncherVersionInfo): string[] {
  const body = renderGeneratedTypeScript(info);
  const written: string[] = [];
  for (const rel of Object.values(GENERATED_PATHS)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, "utf8");
    written.push(rel);
  }
  return written;
}

export function readGitBuildInfo(root: string, semver: string): LauncherBuildInfo {
  try {
    const commit = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim();
    const porcelain = execSync("git status --porcelain", { cwd: root, encoding: "utf8" });
    const dirty = isWorktreeProductDirtyFromPorcelain(porcelain);
    const short = /^[a-f0-9]{40}$/i.test(commit) ? commit.slice(0, 12) : commit.slice(0, 12);
    const buildId = `${semver}@${short}${dirty ? "+dirty" : ""}`;
    return { commit, dirty, buildId };
  } catch {
    return { commit: "unknown", dirty: false, buildId: `${semver}@unknown` };
  }
}

export function renderBuildGeneratedTypeScript(info: LauncherBuildInfo): string {
  return `/* eslint-disable */
/**
 * DO NOT EDIT - generated by pnpm version:generate from git HEAD + package.json SemVer.
 * Distinguishes materially different packaged builds sharing the same SemVer label.
 */
export const LAUNCHER_BUILD_COMMIT = ${JSON.stringify(info.commit)} as const;
export const LAUNCHER_BUILD_DIRTY = ${info.dirty ? "true" : "false"} as const;
export const LAUNCHER_BUILD_ID = ${JSON.stringify(info.buildId)} as const;
`;
}

export function writeBuildGeneratedFiles(root: string, info: LauncherBuildInfo): string[] {
  const body = renderBuildGeneratedTypeScript(info);
  const written: string[] = [];
  for (const rel of Object.values(BUILD_GENERATED_PATHS)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, "utf8");
    written.push(rel);
  }
  return written;
}

export function readGeneratedBuildId(filePath: string): string {
  const raw = fs.readFileSync(filePath, "utf8");
  const m = raw.match(/export const LAUNCHER_BUILD_ID = "([^"]+)" as const;/);
  if (!m) throw new VersionError(`cannot parse LAUNCHER_BUILD_ID from ${filePath}`);
  return m[1]!;
}

/**
 * Sync derived electron-builder PE fields on root package.json (not SemVer).
 * Idempotent: skip write when values already match so CI Windows CRLF checkouts
 * are not dirtied by a no-op JSON.stringify rewrite (PACK-12G dirty P0).
 */
export function syncRootPackageDerivedFields(root: string, info: LauncherVersionInfo): boolean {
  const pkgPath = path.join(root, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
  if (pkg.shortVersion === info.windowsVersion && pkg.shortVersionWindows === info.windowsVersion) {
    return false;
  }
  pkg.shortVersion = info.windowsVersion;
  pkg.shortVersionWindows = info.windowsVersion;
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  return true;
}

/**
 * UI package.json version is not an independent product source — keep synced.
 * Idempotent: skip write when already equal (avoid CRLF/LF no-op dirt).
 */
export function syncUiPackageVersion(root: string, info: LauncherVersionInfo): boolean {
  const pkgPath = path.join(root, "ui", "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
  if (pkg.version === info.semver) {
    return false;
  }
  pkg.version = info.semver;
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  return true;
}

/**
 * Sync electron-builder.yml buildVersion. Idempotent: skip write when already set.
 */
export function syncElectronBuilderBuildVersion(root: string, info: LauncherVersionInfo): boolean {
  const ymlPath = path.join(root, "electron-builder.yml");
  const yml = fs.readFileSync(ymlPath, "utf8");
  const want = `buildVersion: ${info.windowsVersion}`;
  if (new RegExp(`^buildVersion:\\s*${info.windowsVersion.replace(/\./g, "\\.")}\\s*$`, "m").test(yml)) {
    return false;
  }
  const next = /^buildVersion:\s*.*$/m.test(yml)
    ? yml.replace(/^buildVersion:\s*.*$/m, want)
    : `${want}\n${yml}`;
  fs.writeFileSync(ymlPath, next, "utf8");
  return true;
}

export function readGeneratedLauncherVersion(filePath: string): string {
  const raw = fs.readFileSync(filePath, "utf8");
  const m = raw.match(/export const LAUNCHER_VERSION = "([^"]+)" as const;/);
  if (!m) throw new VersionError(`cannot parse LAUNCHER_VERSION from ${filePath}`);
  return m[1]!;
}

export function readGeneratedWindowsVersion(filePath: string): string {
  const raw = fs.readFileSync(filePath, "utf8");
  const m = raw.match(/export const WINDOWS_FILE_VERSION = "([^"]+)" as const;/);
  if (!m) throw new VersionError(`cannot parse WINDOWS_FILE_VERSION from ${filePath}`);
  return m[1]!;
}

export function hasLegalPublisherIdentity(root: string = ROOT): boolean {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
    author?: string | { name?: string };
  };
  if (typeof pkg.author === "string") return pkg.author.trim().length > 0;
  if (pkg.author && typeof pkg.author === "object") {
    return typeof pkg.author.name === "string" && pkg.author.name.trim().length > 0;
  }
  return false;
}
