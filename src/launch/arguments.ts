import { ErrorCode, LauncherError } from "../core/errors/index.js";
import { evaluateRules, parseMinecraftRule, type MinecraftRule } from "../minecraft/rules/index.js";
import type { PlatformInfo } from "../platform/index.js";
import type { LaunchFeatures } from "./features.js";
import { featuresAsRuleMap } from "./features.js";
import {
  assertNoUnresolvedPlaceholders,
  substitutePlaceholders,
  type PlaceholderValues
} from "./placeholders.js";

export interface ResolvedArgumentList {
  /** Ordered argv fragments after rules + placeholder substitution. */
  args: string[];
}

/**
 * Resolve modern Minecraft argument lists (arguments.jvm / arguments.game).
 * Preserves metadata order. Conditional entries use RuleEngine.
 */
export function resolveModernArguments(
  entries: unknown[] | undefined,
  opts: {
    platform: PlatformInfo;
    features: LaunchFeatures;
    placeholders: PlaceholderValues;
    kind: "jvm" | "game";
  }
): string[] {
  if (!entries || entries.length === 0) return [];
  const out: string[] = [];
  const ruleCtx = {
    platform: opts.platform,
    features: featuresAsRuleMap(opts.features)
  };

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (typeof entry === "string") {
      out.push(...expandAndSubstitute(entry, opts.placeholders));
      continue;
    }
    if (!isObj(entry)) {
      throw new LauncherError(ErrorCode.UNSUPPORTED_LAUNCH_METADATA, `invalid ${opts.kind} argument entry`, {
        index: i
      });
    }
    if (!("value" in entry)) {
      throw new LauncherError(ErrorCode.UNSUPPORTED_LAUNCH_METADATA, `${opts.kind} argument missing value`, {
        index: i
      });
    }
    let rules: MinecraftRule[] | undefined;
    if (entry.rules !== undefined) {
      if (!Array.isArray(entry.rules)) {
        throw new LauncherError(ErrorCode.UNSUPPORTED_LAUNCH_METADATA, `${opts.kind} argument rules must be array`, {
          index: i
        });
      }
      rules = entry.rules.map((r, ri) => parseMinecraftRule(r, ri));
    }
    const allowed = evaluateRules(rules, ruleCtx);
    if (!allowed) continue;

    const values = normalizeValue(entry.value, opts.kind, i);
    for (const v of values) {
      out.push(...expandAndSubstitute(v, opts.placeholders));
    }
  }
  return out;
}

function expandAndSubstitute(template: string, placeholders: PlaceholderValues): string[] {
  const substituted = substitutePlaceholders(template, placeholders);
  assertNoUnresolvedPlaceholders(substituted);
  // A single template string becomes one argv entry (even if it contains spaces —
  // Minecraft metadata uses separate array entries for split args).
  return [substituted];
}

function normalizeValue(value: unknown, kind: string, index: number): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const v of value) {
      if (typeof v !== "string") {
        throw new LauncherError(ErrorCode.UNSUPPORTED_LAUNCH_METADATA, `${kind} argument value[] must be strings`, {
          index
        });
      }
      out.push(v);
    }
    return out;
  }
  throw new LauncherError(ErrorCode.UNSUPPORTED_LAUNCH_METADATA, `${kind} argument value must be string|string[]`, {
    index
  });
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Legacy minecraftArguments is not supported for SweetCraft modern targets.
 * Fail closed rather than approximate shell-style splitting.
 */
export function refuseLegacyMinecraftArguments(legacy: string | undefined): void {
  if (typeof legacy === "string" && legacy.length > 0) {
    throw new LauncherError(
      ErrorCode.UNSUPPORTED_LAUNCH_METADATA,
      "legacy minecraftArguments is not supported; require modern arguments.jvm/game",
      {}
    );
  }
}
