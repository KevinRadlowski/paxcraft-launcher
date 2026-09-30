import type { ClientApplyMode } from "../../core/manifest/index.js";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import { writeFileAtomic } from "../../download/fs/index.js";
import { readFile } from "node:fs/promises";
import type { InstancePaths } from "../layout/index.js";

export const INSTANCE_STATE_SCHEMA_VERSION = 1;

export type ManagedFileType = "mod" | "config" | "resourcePack";

export interface ManagedFileRecord {
  type: ManagedFileType;
  /** mod id, resourcePack id, or config path */
  logicalId: string;
  /** Relative POSIX path under instance root (mods/..., config/..., resourcepacks/...) */
  targetPath: string;
  sha256: string;
  size: number;
  /** Config apply policy when type=config */
  policy?: ClientApplyMode;
  /** Resource pack autoEnable — consumed by first-run options.txt seed. */
  autoEnable?: boolean;
  source: "manifest";
}

export interface InstanceState {
  schemaVersion: typeof INSTANCE_STATE_SCHEMA_VERSION;
  installedPackVersion: string | null;
  installedReleaseSequence: number | null;
  installedReleaseSha256: string | null;
  installedManifestSha256: string | null;
  channel: string | null;
  productBase: string | null;
  files: ManagedFileRecord[];
  /** One-shot config migration ids already applied on this instance. */
  appliedConfigMigrations?: string[];
  /** One-shot Minecraft first-run seed ids (options.txt / servers.dat). */
  appliedFirstRunSeeds?: string[];
  /**
   * Pack versions this instance previously held (append-only on version change).
   * Used as durable evidence for missed-migration recovery of fromPackVersions
   * transitions. Fresh install (null → first version) leaves this empty/absent.
   */
  priorPackVersions?: string[];
  updatedAt: string;
}

/** Append previous installed pack version when advancing to a different version. */
export function mergePriorPackVersions(
  previous: Pick<InstanceState, "installedPackVersion" | "priorPackVersions">,
  nextPackVersion: string
): string[] | undefined {
  const prior = [...(previous.priorPackVersions ?? [])];
  const prev = previous.installedPackVersion;
  if (typeof prev === "string" && prev.length > 0 && prev !== nextPackVersion && !prior.includes(prev)) {
    prior.push(prev);
  }
  return prior.length > 0 ? prior : undefined;
}

export function createEmptyInstanceState(): InstanceState {
  return {
    schemaVersion: INSTANCE_STATE_SCHEMA_VERSION,
    installedPackVersion: null,
    installedReleaseSequence: null,
    installedReleaseSha256: null,
    installedManifestSha256: null,
    channel: null,
    productBase: null,
    files: [],
    updatedAt: new Date(0).toISOString()
  };
}

export function parseInstanceStateJson(raw: unknown): InstanceState {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new LauncherError(ErrorCode.CORRUPT_STATE, "instance state is not an object");
  }
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== INSTANCE_STATE_SCHEMA_VERSION) {
    throw new LauncherError(ErrorCode.CORRUPT_STATE, "unsupported or corrupt instance state schema", {
      schemaVersion: o.schemaVersion
    });
  }
  if (!Array.isArray(o.files)) {
    throw new LauncherError(ErrorCode.CORRUPT_STATE, "instance state.files missing");
  }
  const files: ManagedFileRecord[] = [];
  for (const f of o.files) {
    if (typeof f !== "object" || f === null) {
      throw new LauncherError(ErrorCode.CORRUPT_STATE, "corrupt managed file record");
    }
    const rec = f as Record<string, unknown>;
    if (rec.type !== "mod" && rec.type !== "config" && rec.type !== "resourcePack") {
      throw new LauncherError(ErrorCode.CORRUPT_STATE, "invalid managed file type");
    }
    if (typeof rec.logicalId !== "string" || typeof rec.targetPath !== "string") {
      throw new LauncherError(ErrorCode.CORRUPT_STATE, "managed file missing ids");
    }
    if (typeof rec.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(rec.sha256)) {
      throw new LauncherError(ErrorCode.CORRUPT_STATE, "managed file sha256 corrupt");
    }
    if (typeof rec.size !== "number" || !Number.isInteger(rec.size) || rec.size < 0) {
      throw new LauncherError(ErrorCode.CORRUPT_STATE, "managed file size corrupt");
    }
    if (rec.source !== "manifest") {
      throw new LauncherError(ErrorCode.CORRUPT_STATE, "managed file source corrupt");
    }
    const entry: ManagedFileRecord = {
      type: rec.type,
      logicalId: rec.logicalId,
      targetPath: rec.targetPath,
      sha256: rec.sha256,
      size: rec.size,
      source: "manifest"
    };
    if (rec.policy === "force" || rec.policy === "if_missing" || rec.policy === "never_overwrite") {
      entry.policy = rec.policy;
    }
    if (typeof rec.autoEnable === "boolean") {
      entry.autoEnable = rec.autoEnable;
    }
    files.push(entry);
  }

  let appliedConfigMigrations: string[] | undefined;
  if (o.appliedConfigMigrations !== undefined) {
    if (!Array.isArray(o.appliedConfigMigrations)) {
      throw new LauncherError(ErrorCode.CORRUPT_STATE, "appliedConfigMigrations must be array");
    }
    appliedConfigMigrations = o.appliedConfigMigrations.map((id, i) => {
      if (typeof id !== "string" || !id) {
        throw new LauncherError(ErrorCode.CORRUPT_STATE, `appliedConfigMigrations[${i}] invalid`);
      }
      return id;
    });
  }

  let appliedFirstRunSeeds: string[] | undefined;
  if (o.appliedFirstRunSeeds !== undefined) {
    if (!Array.isArray(o.appliedFirstRunSeeds)) {
      throw new LauncherError(ErrorCode.CORRUPT_STATE, "appliedFirstRunSeeds must be array");
    }
    appliedFirstRunSeeds = o.appliedFirstRunSeeds.map((id, i) => {
      if (typeof id !== "string" || !id) {
        throw new LauncherError(ErrorCode.CORRUPT_STATE, `appliedFirstRunSeeds[${i}] invalid`);
      }
      return id;
    });
  }

  let priorPackVersions: string[] | undefined;
  if (o.priorPackVersions !== undefined) {
    if (!Array.isArray(o.priorPackVersions)) {
      throw new LauncherError(ErrorCode.CORRUPT_STATE, "priorPackVersions must be array");
    }
    priorPackVersions = o.priorPackVersions.map((v, i) => {
      if (typeof v !== "string" || !v) {
        throw new LauncherError(ErrorCode.CORRUPT_STATE, `priorPackVersions[${i}] invalid`);
      }
      return v;
    });
  }

  return {
    schemaVersion: INSTANCE_STATE_SCHEMA_VERSION,
    installedPackVersion: typeof o.installedPackVersion === "string" ? o.installedPackVersion : null,
    installedReleaseSequence:
      typeof o.installedReleaseSequence === "number" ? o.installedReleaseSequence : null,
    installedReleaseSha256: typeof o.installedReleaseSha256 === "string" ? o.installedReleaseSha256 : null,
    installedManifestSha256:
      typeof o.installedManifestSha256 === "string" ? o.installedManifestSha256 : null,
    channel: typeof o.channel === "string" ? o.channel : null,
    productBase: typeof o.productBase === "string" ? o.productBase : null,
    files,
    ...(appliedConfigMigrations ? { appliedConfigMigrations } : {}),
    ...(appliedFirstRunSeeds ? { appliedFirstRunSeeds } : {}),
    ...(priorPackVersions && priorPackVersions.length > 0 ? { priorPackVersions } : {}),
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : new Date(0).toISOString()
  };
}

export class InstanceStateStore {
  constructor(private readonly paths: InstancePaths) {}

  async load(): Promise<InstanceState> {
    try {
      const raw = await readFile(this.paths.stateFile(), "utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new LauncherError(ErrorCode.CORRUPT_STATE, "instance state JSON parse failed");
      }
      return parseInstanceStateJson(parsed);
    } catch (e) {
      if (LauncherError.isLauncherError(e)) throw e;
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return createEmptyInstanceState();
      }
      throw new LauncherError(ErrorCode.STATE_ERROR, "failed to load instance state", {
        cause: e instanceof Error ? e.message : String(e)
      });
    }
  }

  async saveAtomic(state: InstanceState): Promise<void> {
    const payload = JSON.stringify(state, null, 2) + "\n";
    await writeFileAtomic(this.paths.stateFile(), payload);
  }
}
