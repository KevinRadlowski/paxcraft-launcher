import { assertSha256Hex, sha256Hex, SHA256_HEX_RE } from "../crypto/index.js";
import { ErrorCode, LauncherError } from "../errors/index.js";
import {
  assertSafeConfigPath,
  assertSafeResourcePackId,
  assertSafeResourcePackTargetPath
} from "../paths/index.js";
import { MANIFEST_SCHEMA_VERSION, MANIFEST_SCHEMA_VERSION_LEGACY, RELEASE_FILES_BASE } from "../release/index.js";
import {
  parseConfigMigrations,
  type ManifestConfigMigration
} from "./configMigration.js";

export type { ConfigMigrationLeafValue, ConfigMigrationSetEntry, ManifestConfigMigration } from "./configMigration.js";
export { assertValidJsonPath, parseConfigMigration, parseConfigMigrations } from "./configMigration.js";

/** Client-facing apply modes that the Instance Manager will honor. */
export const CLIENT_APPLY_MODES = ["force", "if_missing", "never_overwrite"] as const;
export type ClientApplyMode = (typeof CLIENT_APPLY_MODES)[number];

/** Policies that must never appear in a valid client manifest. */
export const FORBIDDEN_CLIENT_POLICIES = new Set([
  "EXCLUDED",
  "COMMON_FORCE_REVIEW",
  "NEVER_CLIENT_SECRET_REVIEW",
  "CLIENT_DEFAULT_PRESERVE"
]);

export const FORBIDDEN_CLIENT_APPLY = new Set(["review", "never_client", "excluded"]);

export type ConfigTarget = "CLIENT" | "SERVER" | "BOTH" | "NONE";

export interface ManifestModProvider {
  type: string;
  url?: string | null;
  projectId?: string | number | null;
  versionId?: string | null;
  fileId?: number | null;
  project?: string | null;
}

export interface ManifestMod {
  id: string;
  name: string;
  version: string;
  file: string;
  size: number;
  sha256: string;
  sha512: string | null;
  provider: ManifestModProvider;
  distribution: string;
}

export interface ManifestConfig {
  path: string;
  sha256: string;
  policy: string;
  apply: ClientApplyMode;
  target: ConfigTarget;
}

export interface ManifestResourcePack {
  id: string;
  displayName: string;
  version: string;
  targetPath: string;
  sha256: string;
  size: number;
  autoEnable: boolean;
}

export interface ClientManifest {
  schemaVersion: 5 | 6;
  product: "SweetCraft";
  target: "client";
  packVersion: string;
  minecraft: string;
  fabricLoader: string;
  server: string;
  configBase: typeof RELEASE_FILES_BASE;
  generatedAt: string;
  mods: ManifestMod[];
  configs: ManifestConfig[];
  resourcePacks: ManifestResourcePack[];
  /** Optional one-shot structured migrations (schema 6+). */
  configMigrations?: ManifestConfigMigration[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertPositiveSize(size: unknown, field: string): number {
  if (typeof size !== "number" || !Number.isInteger(size) || size < 0) {
    throw new LauncherError(ErrorCode.INVALID_MANIFEST, `invalid ${field}`, { size });
  }
  return size;
}

function parseProvider(raw: unknown): ManifestModProvider {
  if (!isPlainObject(raw) || typeof raw.type !== "string" || !raw.type) {
    throw new LauncherError(ErrorCode.INVALID_MANIFEST, "mod provider invalid");
  }
  const provider: ManifestModProvider = { type: raw.type };
  if ("url" in raw) {
    provider.url = raw.url === null || typeof raw.url === "string" ? (raw.url as string | null) : null;
  }
  if ("projectId" in raw) {
    provider.projectId =
      raw.projectId === null || typeof raw.projectId === "string" || typeof raw.projectId === "number"
        ? (raw.projectId as string | number | null)
        : null;
  }
  if ("versionId" in raw) {
    provider.versionId =
      raw.versionId === null || typeof raw.versionId === "string" ? (raw.versionId as string | null) : null;
  }
  if ("fileId" in raw) {
    provider.fileId =
      raw.fileId === null || typeof raw.fileId === "number" ? (raw.fileId as number | null) : null;
  }
  if ("project" in raw) {
    provider.project =
      raw.project === null || typeof raw.project === "string" ? (raw.project as string | null) : null;
  }
  return provider;
}

function parseMod(raw: unknown, index: number): ManifestMod {
  if (!isPlainObject(raw)) {
    throw new LauncherError(ErrorCode.INVALID_MANIFEST, `mod[${index}] invalid`);
  }
  for (const field of ["id", "name", "version", "file"] as const) {
    if (typeof raw[field] !== "string" || !raw[field]) {
      throw new LauncherError(ErrorCode.INVALID_MANIFEST, `mod[${index}].${field} missing`);
    }
  }
  if (typeof raw.file === "string" && (raw.file.includes("/") || raw.file.includes("\\") || raw.file.includes(".."))) {
    throw new LauncherError(ErrorCode.UNSAFE_PATH, `mod[${index}].file must be a basename`, { file: raw.file });
  }
  const sha256 = assertSha256Hex(raw.sha256, `mod[${index}].sha256`);
  let sha512: string | null = null;
  if (raw.sha512 !== null && raw.sha512 !== undefined) {
    if (typeof raw.sha512 !== "string" || !/^[a-fA-F0-9]{128}$/.test(raw.sha512)) {
      throw new LauncherError(ErrorCode.INVALID_MANIFEST, `mod[${index}].sha512 invalid`);
    }
    sha512 = raw.sha512.toLowerCase();
  }
  if (typeof raw.distribution !== "string" || !raw.distribution) {
    throw new LauncherError(ErrorCode.INVALID_MANIFEST, `mod[${index}].distribution missing`);
  }
  return {
    id: raw.id as string,
    name: raw.name as string,
    version: raw.version as string,
    file: raw.file as string,
    size: assertPositiveSize(raw.size, `mod[${index}].size`),
    sha256,
    sha512,
    provider: parseProvider(raw.provider),
    distribution: raw.distribution
  };
}

function parseConfig(raw: unknown, index: number): ManifestConfig {
  if (!isPlainObject(raw)) {
    throw new LauncherError(ErrorCode.INVALID_MANIFEST, `config[${index}] invalid`);
  }
  if (typeof raw.path !== "string") {
    throw new LauncherError(ErrorCode.INVALID_MANIFEST, `config[${index}].path missing`);
  }
  assertSafeConfigPath(raw.path);
  if (typeof raw.policy !== "string" || !raw.policy) {
    throw new LauncherError(ErrorCode.INVALID_MANIFEST, `config[${index}].policy missing`);
  }
  if (FORBIDDEN_CLIENT_POLICIES.has(raw.policy)) {
    throw new LauncherError(ErrorCode.INVALID_CONFIG_POLICY, `forbidden client config policy: ${raw.policy}`, {
      policy: raw.policy,
      path: raw.path
    });
  }
  if (typeof raw.apply !== "string") {
    throw new LauncherError(ErrorCode.INVALID_CONFIG_POLICY, `config[${index}].apply missing`);
  }
  if (FORBIDDEN_CLIENT_APPLY.has(raw.apply)) {
    throw new LauncherError(ErrorCode.INVALID_CONFIG_POLICY, `forbidden client apply mode: ${raw.apply}`, {
      apply: raw.apply,
      path: raw.path
    });
  }
  if (!(CLIENT_APPLY_MODES as readonly string[]).includes(raw.apply)) {
    throw new LauncherError(ErrorCode.INVALID_CONFIG_POLICY, `unknown config apply policy: ${raw.apply}`, {
      apply: raw.apply,
      path: raw.path
    });
  }
  const target = raw.target;
  if (target !== "CLIENT" && target !== "SERVER" && target !== "BOTH" && target !== "NONE") {
    throw new LauncherError(ErrorCode.INVALID_MANIFEST, `config[${index}].target invalid`, { target });
  }
  if (target === "NONE" || target === "SERVER") {
    throw new LauncherError(ErrorCode.INVALID_MANIFEST, `client manifest config target must include CLIENT`, {
      target,
      path: raw.path
    });
  }
  return {
    path: raw.path,
    sha256: assertSha256Hex(raw.sha256, `config[${index}].sha256`),
    policy: raw.policy,
    apply: raw.apply as ClientApplyMode,
    target
  };
}

function parseResourcePack(raw: unknown, index: number): ManifestResourcePack {
  if (!isPlainObject(raw)) {
    throw new LauncherError(ErrorCode.INVALID_MANIFEST, `resourcePacks[${index}] invalid`);
  }
  if ("sourcePath" in raw) {
    throw new LauncherError(ErrorCode.INVALID_MANIFEST, `resourcePacks[${index}].sourcePath forbidden in client manifest`, {
      index
    });
  }
  for (const field of ["id", "displayName", "version", "targetPath"] as const) {
    if (typeof raw[field] !== "string" || !raw[field]) {
      throw new LauncherError(ErrorCode.INVALID_MANIFEST, `resourcePacks[${index}].${field} missing`);
    }
  }
  assertSafeResourcePackId(raw.id as string);
  assertSafeResourcePackTargetPath(raw.targetPath as string);
  if (typeof raw.autoEnable !== "boolean") {
    throw new LauncherError(ErrorCode.INVALID_MANIFEST, `resourcePacks[${index}].autoEnable must be boolean`);
  }
  if (typeof raw.sha256 !== "string" || !SHA256_HEX_RE.test(raw.sha256.toLowerCase())) {
    throw new LauncherError(ErrorCode.INVALID_MANIFEST, `resourcePacks[${index}].sha256 invalid`);
  }
  return {
    id: raw.id as string,
    displayName: raw.displayName as string,
    version: raw.version as string,
    targetPath: raw.targetPath as string,
    sha256: raw.sha256.toLowerCase(),
    size: assertPositiveSize(raw.size, `resourcePacks[${index}].size`),
    autoEnable: raw.autoEnable
  };
}

export function parseClientManifestJson(raw: unknown): ClientManifest {
  if (!isPlainObject(raw)) {
    throw new LauncherError(ErrorCode.INVALID_MANIFEST, "manifest must be a JSON object");
  }
  if (raw.schemaVersion !== MANIFEST_SCHEMA_VERSION && raw.schemaVersion !== MANIFEST_SCHEMA_VERSION_LEGACY) {
    throw new LauncherError(ErrorCode.UNSUPPORTED_SCHEMA, "unsupported manifest schemaVersion", {
      schemaVersion: raw.schemaVersion
    });
  }
  if (raw.product !== "SweetCraft") {
    throw new LauncherError(ErrorCode.INVALID_MANIFEST, "unexpected product");
  }
  if (raw.target !== "client") {
    throw new LauncherError(ErrorCode.INVALID_MANIFEST, "expected target=client");
  }
  for (const field of ["packVersion", "minecraft", "fabricLoader", "server", "generatedAt"] as const) {
    if (typeof raw[field] !== "string" || !raw[field]) {
      throw new LauncherError(ErrorCode.INVALID_MANIFEST, `${field} missing`);
    }
  }
  if (raw.configBase !== RELEASE_FILES_BASE) {
    throw new LauncherError(ErrorCode.INVALID_MANIFEST, `configBase must be ${RELEASE_FILES_BASE}`);
  }
  if (!Array.isArray(raw.mods)) {
    throw new LauncherError(ErrorCode.INVALID_MANIFEST, "mods must be an array");
  }
  if (!Array.isArray(raw.configs)) {
    throw new LauncherError(ErrorCode.INVALID_MANIFEST, "configs must be an array");
  }

  const mods = raw.mods.map((m, i) => parseMod(m, i));
  const configs = raw.configs.map((c, i) => parseConfig(c, i));

  let resourcePacks: ManifestResourcePack[];
  if (raw.schemaVersion === MANIFEST_SCHEMA_VERSION) {
    if (!Array.isArray(raw.resourcePacks)) {
      throw new LauncherError(ErrorCode.INVALID_MANIFEST, "schema 6 requires resourcePacks[]");
    }
    resourcePacks = raw.resourcePacks.map((rp, i) => parseResourcePack(rp, i));
  } else {
    // Schema 5 legacy: resourcePacks implicitly [].
    if (raw.resourcePacks === undefined) {
      resourcePacks = [];
    } else if (Array.isArray(raw.resourcePacks)) {
      resourcePacks = raw.resourcePacks.map((rp, i) => parseResourcePack(rp, i));
    } else {
      throw new LauncherError(ErrorCode.INVALID_MANIFEST, "schema 5 resourcePacks must be array or absent");
    }
  }

  const seenIds = new Set<string>();
  for (const rp of resourcePacks) {
    if (seenIds.has(rp.id)) {
      throw new LauncherError(ErrorCode.INVALID_MANIFEST, `duplicate resourcePack id: ${rp.id}`, { id: rp.id });
    }
    seenIds.add(rp.id);
  }

  const configMigrations = parseConfigMigrations(raw.configMigrations);

  return {
    schemaVersion: raw.schemaVersion,
    product: "SweetCraft",
    target: "client",
    packVersion: raw.packVersion as string,
    minecraft: raw.minecraft as string,
    fabricLoader: raw.fabricLoader as string,
    server: raw.server as string,
    configBase: RELEASE_FILES_BASE,
    generatedAt: raw.generatedAt as string,
    mods,
    configs,
    resourcePacks,
    ...(configMigrations.length > 0 ? { configMigrations } : {})
  };
}

export function parseClientManifestBytes(bytes: Buffer | string): ClientManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof bytes === "string" ? bytes : bytes.toString("utf8"));
  } catch (e) {
    throw new LauncherError(ErrorCode.INVALID_MANIFEST, "manifest JSON parse failed", {
      cause: e instanceof Error ? e.message : String(e)
    });
  }
  return parseClientManifestJson(parsed);
}

export function assertManifestBytesHash(bytes: Buffer, expectedSha256: string): string {
  const actual = sha256Hex(bytes);
  const expected = expectedSha256.toLowerCase();
  if (actual !== expected) {
    throw new LauncherError(ErrorCode.MANIFEST_HASH_MISMATCH, "client-manifest.json SHA-256 mismatch", {
      expected,
      actual
    });
  }
  return actual;
}
