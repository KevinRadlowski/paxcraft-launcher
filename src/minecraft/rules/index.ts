import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import type { PlatformInfo } from "../../platform/index.js";

/**
 * Minecraft library/argument rule.
 *
 * Official semantics (simplified, documented):
 * - Default (no rules): allow
 * - Rules evaluated in order; last matching rule wins
 * - action = allow | disallow
 * - os.name: windows | osx | linux
 * - os.arch: compared loosely against PlatformInfo (x86_64 ≈ x64)
 * - features: unknown feature keys → rule does not match (fail closed for allow that
 *   requires unknown features; disallow with unknown features also does not match)
 */
export interface MinecraftRule {
  action: "allow" | "disallow";
  os?: {
    name?: string;
    arch?: string;
    version?: string;
  };
  features?: Record<string, boolean>;
}

/**
 * Structural validation of a single Minecraft library/argument rule.
 * Evaluation of supported constructions happens later in `evaluateRules`.
 */
export function parseMinecraftRule(raw: unknown, index: number): MinecraftRule {
  if (!isObj(raw)) {
    throw new LauncherError(ErrorCode.INVALID_MINECRAFT_METADATA, `malformed library rule[${index}]`, {
      index
    });
  }
  if (raw.action !== "allow" && raw.action !== "disallow") {
    throw new LauncherError(ErrorCode.INVALID_MINECRAFT_METADATA, `malformed library rule[${index}] action`, {
      index,
      action: raw.action
    });
  }
  const rule: MinecraftRule = { action: raw.action };
  if (raw.os !== undefined) {
    if (!isObj(raw.os)) {
      throw new LauncherError(ErrorCode.INVALID_MINECRAFT_METADATA, `malformed library rule[${index}] os`, {
        index
      });
    }
    const os: NonNullable<MinecraftRule["os"]> = {};
    if (raw.os.name !== undefined) {
      if (typeof raw.os.name !== "string") {
        throw new LauncherError(ErrorCode.INVALID_MINECRAFT_METADATA, `malformed library rule[${index}] os.name`, {
          index
        });
      }
      os.name = raw.os.name;
    }
    if (raw.os.arch !== undefined) {
      if (typeof raw.os.arch !== "string") {
        throw new LauncherError(ErrorCode.INVALID_MINECRAFT_METADATA, `malformed library rule[${index}] os.arch`, {
          index
        });
      }
      os.arch = raw.os.arch;
    }
    if (raw.os.version !== undefined) {
      if (typeof raw.os.version !== "string") {
        throw new LauncherError(
          ErrorCode.INVALID_MINECRAFT_METADATA,
          `malformed library rule[${index}] os.version`,
          { index }
        );
      }
      os.version = raw.os.version;
    }
    rule.os = os;
  }
  if (raw.features !== undefined) {
    if (!isObj(raw.features)) {
      throw new LauncherError(ErrorCode.INVALID_MINECRAFT_METADATA, `malformed library rule[${index}] features`, {
        index
      });
    }
    const features: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(raw.features)) {
      if (typeof v !== "boolean") {
        throw new LauncherError(
          ErrorCode.INVALID_MINECRAFT_METADATA,
          `malformed library rule[${index}] features value`,
          { index, key: k }
        );
      }
      features[k] = v;
    }
    rule.features = features;
  }
  return rule;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export interface RuleEvaluationContext {
  platform: PlatformInfo;
  features?: Record<string, boolean>;
}

export function evaluateRules(
  rules: MinecraftRule[] | undefined,
  ctx: RuleEvaluationContext
): boolean {
  if (!rules || rules.length === 0) {
    return true; // no rules ⇒ allowed
  }

  let allowed = false; // official: when rules present, start from disallow until allow matches
  // Mojang semantics: if rules array exists, default is disallow, then apply matching rules in order.
  for (const rule of rules) {
    if (rule.action !== "allow" && rule.action !== "disallow") {
      throw new LauncherError(ErrorCode.LIBRARY_RULE_UNSUPPORTED, "unsupported rule action", {
        action: rule.action
      });
    }
    if (ruleMatches(rule, ctx)) {
      allowed = rule.action === "allow";
    }
  }
  return allowed;
}

function ruleMatches(rule: MinecraftRule, ctx: RuleEvaluationContext): boolean {
  if (rule.os) {
    if (rule.os.name) {
      const expected = rule.os.name.toLowerCase();
      const actual = ctx.platform.minecraftOsName;
      if (!actual || actual !== expected) return false;
    }
    if (rule.os.arch) {
      if (!archMatches(rule.os.arch, ctx.platform)) return false;
    }
    // os.version: if present and non-empty, we do not support regex evaluation yet → fail closed
    if (typeof rule.os.version === "string" && rule.os.version.length > 0) {
      throw new LauncherError(
        ErrorCode.LIBRARY_RULE_UNSUPPORTED,
        "os.version rule conditions are not supported",
        { version: rule.os.version }
      );
    }
  }
  if (rule.features) {
    const provided = ctx.features ?? {};
    for (const [key, expected] of Object.entries(rule.features)) {
      if (!(key in provided)) {
        // Unknown feature → rule does not match
        return false;
      }
      if (provided[key] !== expected) return false;
    }
  }
  return true;
}

function archMatches(ruleArch: string, platform: PlatformInfo): boolean {
  const a = ruleArch.toLowerCase();
  if (a === "x86" || a === "i386" || a === "i686") return platform.arch === "x86";
  if (a === "x86_64" || a === "amd64" || a === "x64") return platform.arch === "x64";
  if (a === "arm64" || a === "aarch64") return platform.arch === "arm64";
  if (a === "arm" || a === "arm32") return platform.arch === "arm";
  return false;
}
