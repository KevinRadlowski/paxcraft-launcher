import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import { writeFileAtomic } from "../../download/fs/index.js";
import type { InstancePaths } from "../layout/index.js";
import type { InstanceState, ManagedFileRecord } from "../state/instanceState.js";
import {
  FIRST_RUN_SEED_OPTIONS,
  FIRST_RUN_SEED_SERVERS,
  OPTIONS_REL_PATH,
  SERVERS_REL_PATH,
  SWEETCRAFT_SERVER_ADDRESS,
  SWEETCRAFT_SERVER_NAME
} from "./constants.js";
import {
  basenameFromResourcePackTarget,
  createFreshOptionsTxt,
  resourcePackFileEntry
} from "./optionsTxt.js";
import { encodeServersDat } from "./serversDat.js";

export interface FirstRunSeedResult {
  appliedSeedIds: string[];
  nextState: InstanceState;
}

function alreadyApplied(state: InstanceState, id: string): boolean {
  return (state.appliedFirstRunSeeds ?? []).includes(id);
}

function withSeedIds(state: InstanceState, ids: string[]): InstanceState {
  const merged = [...(state.appliedFirstRunSeeds ?? [])];
  for (const id of ids) {
    if (!merged.includes(id)) merged.push(id);
  }
  return {
    ...state,
    ...(merged.length > 0 ? { appliedFirstRunSeeds: merged } : {}),
    updatedAt: new Date().toISOString()
  };
}

export function autoEnableResourcePackFileEntries(managedFiles: ManagedFileRecord[]): string[] {
  const entries: string[] = [];
  for (const f of managedFiles) {
    if (f.type !== "resourcePack" || f.autoEnable !== true) continue;
    entries.push(resourcePackFileEntry(basenameFromResourcePackTarget(f.targetPath)));
  }
  return entries;
}

/**
 * SYNC-12B: target exists → preserve bytes (do not read/parse/rewrite).
 * Unreadable existing paths fail closed — never treated as fresh/absent.
 */
async function targetExists(abs: string, label: string): Promise<boolean> {
  try {
    await access(abs, fsConstants.F_OK);
    return true;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return false;
    throw new LauncherError(ErrorCode.FIRST_RUN_SEED_FAILED, `failed to access ${label}`, {
      cause: e instanceof Error ? e.message : String(e)
    });
  }
}

async function seedOptionsTxt(
  paths: InstancePaths,
  managedFiles: ManagedFileRecord[]
): Promise<void> {
  const abs = paths.absoluteForRelative(OPTIONS_REL_PATH);
  if (await targetExists(abs, OPTIONS_REL_PATH)) {
    return;
  }
  const autoEnable = autoEnableResourcePackFileEntries(managedFiles);
  await writeFileAtomic(abs, createFreshOptionsTxt(autoEnable));
}

async function seedServersDat(paths: InstancePaths): Promise<void> {
  const abs = paths.absoluteForRelative(SERVERS_REL_PATH);
  if (await targetExists(abs, SERVERS_REL_PATH)) {
    return;
  }
  const created = encodeServersDat([
    { name: SWEETCRAFT_SERVER_NAME, ip: SWEETCRAFT_SERVER_ADDRESS }
  ]);
  await writeFileAtomic(abs, created);
}

/**
 * Authoritative first-run seed for Minecraft preferences (SYNC-12B).
 *
 * Ownership contract:
 * - Absent target file → create fresh SweetCraft defaults, then record seed id.
 * - Existing target file + missing marker → preserve bytes exactly, record seed id only
 *   (legacy / user-owned; never infer intent from en_us / packs / server absence).
 * - Marker present → no-op forever (repair/update never re-seed).
 * - Seed ids are returned for state commit by the caller; no false marker if write fails.
 */
export async function applyFirstRunSeeds(opts: {
  paths: InstancePaths;
  state: InstanceState;
  managedFiles: ManagedFileRecord[];
}): Promise<FirstRunSeedResult | null> {
  const pending: string[] = [];

  if (!alreadyApplied(opts.state, FIRST_RUN_SEED_OPTIONS)) {
    await seedOptionsTxt(opts.paths, opts.managedFiles);
    pending.push(FIRST_RUN_SEED_OPTIONS);
  }

  if (!alreadyApplied(opts.state, FIRST_RUN_SEED_SERVERS)) {
    await seedServersDat(opts.paths);
    pending.push(FIRST_RUN_SEED_SERVERS);
  }

  if (pending.length === 0) return null;
  return {
    appliedSeedIds: pending,
    nextState: withSeedIds(opts.state, pending)
  };
}
