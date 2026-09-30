import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import {
  MINECRAFT_DEFAULT_LANG,
  SWEETCRAFT_DEFAULT_LANG
} from "./constants.js";

export interface OptionsTxtDocument {
  /** Original newline style. */
  newline: "\n" | "\r\n";
  /** Ordered keys as they appear; duplicates keep last write wins on map. */
  order: string[];
  values: Map<string, string>;
}

function fail(message: string, details: Record<string, unknown> = {}): never {
  throw new LauncherError(ErrorCode.FIRST_RUN_SEED_FAILED, message, details);
}

/**
 * Parse Minecraft options.txt (`key:value` lines). Values may contain `:`.
 * Blank lines and unknown structure fail closed only when resourcePacks is present but invalid JSON.
 */
export function parseOptionsTxt(raw: string): OptionsTxtDocument {
  const newline: "\n" | "\r\n" = raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = raw.split(/\r?\n/);
  // Drop trailing empty line from final newline
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const order: string[] = [];
  const values = new Map<string, string>();
  for (const line of lines) {
    if (line === "") {
      continue;
    }
    const idx = line.indexOf(":");
    if (idx <= 0) fail("options.txt line missing key", { line: line.slice(0, 64) });
    const key = line.slice(0, idx);
    const value = line.slice(idx + 1);
    if (!values.has(key)) order.push(key);
    values.set(key, value);
  }
  return { newline, order, values };
}

export function serializeOptionsTxt(doc: OptionsTxtDocument): string {
  const lines = doc.order.map(key => `${key}:${doc.values.get(key) ?? ""}`);
  for (const key of doc.values.keys()) {
    if (!doc.order.includes(key)) lines.push(`${key}:${doc.values.get(key)}`);
  }
  return lines.join(doc.newline) + doc.newline;
}

export function parseResourcePacksValue(raw: string | undefined): string[] {
  if (raw === undefined || raw === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    fail("options.txt resourcePacks is not valid JSON", {
      cause: e instanceof Error ? e.message : String(e)
    });
  }
  if (!Array.isArray(parsed) || parsed.some(x => typeof x !== "string")) {
    fail("options.txt resourcePacks must be a JSON string array");
  }
  return parsed as string[];
}

export function resourcePackFileEntry(zipFileName: string): string {
  return `file/${zipFileName}`;
}

export function basenameFromResourcePackTarget(targetPath: string): string {
  const norm = targetPath.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  return i >= 0 ? norm.slice(i + 1) : norm;
}

/**
 * Helper retained for tests / diagnostics. SYNC-12B seed path never mutates an
 * existing options.txt, so this is not used for legacy backfill.
 */
export function resolveFirstRunLang(current: string | undefined): string {
  if (current === undefined || current === "" || current === MINECRAFT_DEFAULT_LANG) {
    return SWEETCRAFT_DEFAULT_LANG;
  }
  return current;
}

/**
 * Merge autoEnable pack file entries into resourcePacks without removing user packs.
 * Used only when creating a fresh options.txt (file absent).
 */
export function mergeAutoEnableResourcePacks(
  current: string[],
  autoEnableFileEntries: string[]
): string[] {
  const next = [...current];
  if (next.length === 0) {
    next.push("vanilla");
  } else if (!next.includes("vanilla")) {
    next.unshift("vanilla");
  }
  for (const entry of autoEnableFileEntries) {
    if (!next.includes(entry)) next.push(entry);
  }
  return next;
}

export function createFreshOptionsTxt(autoEnableFileEntries: string[]): string {
  const packs = mergeAutoEnableResourcePacks([], autoEnableFileEntries);
  return [
    `resourcePacks:${JSON.stringify(packs)}`,
    `incompatibleResourcePacks:[]`,
    `lang:${SWEETCRAFT_DEFAULT_LANG}`
  ].join("\n") + "\n";
}
