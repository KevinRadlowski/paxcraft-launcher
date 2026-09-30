/**
 * PACK-10.1G.1 — SweetCraft instance root ownership provenance.
 *
 * Ownership proof: presence of launcher/state.json with schemaVersion === 1.
 * Settings alone never prove ownership — this marker survives SAFE uninstall
 * (empty state is written atomically) and moves with the instance tree.
 *
 * PACK-10.1G.2 identity audit — InstanceState fields (see instanceState.ts):
 *   schemaVersion, installedPackVersion, installedReleaseSequence, channel,
 *   productBase (CDN origin URL when installed; null after SAFE), files[], updatedAt.
 * No dedicated product/instanceId field exists. productBase is not stable post-SAFE.
 * schemaVersion === 1 on launcher/state.json remains the ownership contract because
 * only SweetCraft launcher writes this file at this canonical instance layout path.
 */
import fs from "node:fs";
import path from "node:path";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import { INSTANCE_STATE_SCHEMA_VERSION } from "../state/instanceState.js";

export const INSTANCE_STATE_RELATIVE = "launcher/state.json";

export type InstanceRootOwnership = "MISSING" | "EMPTY" | "OWNED" | "UNRECOGNIZED";

export type CompleteUninstallDeleteMode = "NOOP" | "EMPTY_ONLY" | "RECURSIVE";

function existsAt(p: string, existsSync: (p: string) => boolean): boolean {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
}

/** True when launcher/state.json exists with supported schemaVersion. */
export function hasSweetCraftOwnershipMarker(
  instanceRoot: string,
  existsSync: (p: string) => boolean = fs.existsSync
): boolean {
  const statePath = path.join(path.resolve(instanceRoot), INSTANCE_STATE_RELATIVE);
  if (!existsAt(statePath, existsSync)) return false;
  try {
    const text = fs.readFileSync(statePath, "utf8");
    const raw = JSON.parse(text) as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
    return (raw as Record<string, unknown>).schemaVersion === INSTANCE_STATE_SCHEMA_VERSION;
  } catch {
    return false;
  }
}

/**
 * Classify an instance root without trusting settings.
 * OWNED = launcher/state.json with schemaVersion 1 (installed or post-SAFE).
 */
export function classifyInstanceRootOwnership(
  instanceRoot: string,
  existsSync: (p: string) => boolean = fs.existsSync
): InstanceRootOwnership {
  const root = path.resolve(instanceRoot);
  if (!existsAt(root, existsSync)) return "MISSING";
  try {
    const entries = fs.readdirSync(root);
    if (entries.length === 0) return "EMPTY";
  } catch {
    return "UNRECOGNIZED";
  }
  return hasSweetCraftOwnershipMarker(root, existsSync) ? "OWNED" : "UNRECOGNIZED";
}

/**
 * NOT_INSTALLED location selection — absent or empty directory only.
 * Rejects non-empty unrelated directories and existing SweetCraft roots.
 */
export function assertFreshInstallLocationAllowed(
  instanceRoot: string,
  existsSync: (p: string) => boolean = fs.existsSync
): void {
  const classification = classifyInstanceRootOwnership(instanceRoot, existsSync);
  if (classification === "MISSING" || classification === "EMPTY") return;
  if (classification === "OWNED") {
    throw new LauncherError(
      ErrorCode.INSTANCE_ALREADY_INSTALLED,
      "destination already contains a SweetCraft instance",
      { classification }
    );
  }
  throw new LauncherError(
    ErrorCode.INSTANCE_LOCATION_NOT_EMPTY,
    "destination directory is not empty",
    { classification }
  );
}

/**
 * COMPLETE uninstall ownership gate.
 * RECURSIVE only when ownership marker proves launcher ownership.
 */
export function resolveCompleteUninstallDeleteMode(
  instanceRoot: string,
  existsSync: (p: string) => boolean = fs.existsSync
): CompleteUninstallDeleteMode {
  const classification = classifyInstanceRootOwnership(instanceRoot, existsSync);
  switch (classification) {
    case "MISSING":
      return "NOOP";
    case "EMPTY":
      return "EMPTY_ONLY";
    case "OWNED":
      return "RECURSIVE";
    default:
      throw new LauncherError(
        ErrorCode.INSTANCE_OWNERSHIP_NOT_PROVEN,
        "refusing complete uninstall on non-owned instance root",
        { classification }
      );
  }
}

/** Shared migration / fresh-install destination policy. */
export function assertEmptyOrAbsentDestination(
  destination: string,
  existsSync: (p: string) => boolean = fs.existsSync
): void {
  assertFreshInstallLocationAllowed(destination, existsSync);
}
