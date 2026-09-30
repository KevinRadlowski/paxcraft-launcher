import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import type { ConfigMigrationLeafValue } from "../../core/manifest/configMigration.js";

export function getAtPath(root: unknown, dotPath: string): unknown {
  let current: unknown = root;
  for (const segment of dotPath.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function valuesEqual(a: unknown, b: ConfigMigrationLeafValue): boolean {
  return Object.is(a, b);
}

/**
 * Set a leaf value, creating intermediate objects when absent.
 * Fails closed when an intermediate segment exists but is not a plain object.
 */
export function setLeafPath(
  root: Record<string, unknown>,
  dotPath: string,
  value: ConfigMigrationLeafValue
): boolean {
  const segments = dotPath.split(".");
  if (segments.length === 0) {
    throw new LauncherError(ErrorCode.CONFIG_MIGRATION_FAILED, "empty json path");
  }
  let current: Record<string, unknown> = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const key = segments[i]!;
    const next = current[key];
    if (next === undefined) {
      const created: Record<string, unknown> = {};
      current[key] = created;
      current = created;
      continue;
    }
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      throw new LauncherError(ErrorCode.CONFIG_MIGRATION_FAILED, "intermediate path is not an object", {
        path: dotPath,
        segment: key
      });
    }
    current = next as Record<string, unknown>;
  }
  const leafKey = segments[segments.length - 1]!;
  const prev = current[leafKey];
  if (valuesEqual(prev, value)) {
    return false;
  }
  if (prev !== undefined && (typeof prev === "object" && prev !== null)) {
    throw new LauncherError(ErrorCode.CONFIG_MIGRATION_FAILED, "target path is not a leaf value", {
      path: dotPath
    });
  }
  current[leafKey] = value;
  return true;
}
