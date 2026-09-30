/**
 * Strict settings update DTO validation — Main-authoritative.
 * Rejects arbitrary keys (javaPath, jvmArgs, channel, etc.).
 */

import type { SettingsDto, SettingsUpdateDto, UiError } from "../../shared/contract.js";
import { toUiError } from "../../shared/validate.js";
import {
  isValidMemoryMiB,
  SETTINGS_MEMORY_DEFAULT_MIB,
  SETTINGS_MEMORY_MAX_MIB,
  SETTINGS_MEMORY_MIN_MIB
} from "./settings-store.js";

export type { SettingsUpdateDto };

const ALLOWED_UPDATE_KEYS = new Set(["memoryMiB", "reducedMotion"]);

const FORBIDDEN_UPDATE_KEYS = [
  "javaPath",
  "javaExecutable",
  "extraJvmArgs",
  "jvmArgs",
  "channel",
  "serverAddress",
  "server",
  "language",
  "schemaVersion",
  "accessToken",
  "refreshToken"
] as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function assertSettingsUpdatePayload(raw: unknown): SettingsUpdateDto {
  if (!isPlainObject(raw)) {
    throw settingsInvalid("payload must be object");
  }

  for (const key of Object.keys(raw)) {
    if (FORBIDDEN_UPDATE_KEYS.includes(key as (typeof FORBIDDEN_UPDATE_KEYS)[number])) {
      throw settingsInvalid(`forbidden field: ${key}`);
    }
    if (!ALLOWED_UPDATE_KEYS.has(key)) {
      throw settingsInvalid(`unknown field: ${key}`);
    }
  }

  const out: { memoryMiB?: number; reducedMotion?: boolean } = {};

  if ("memoryMiB" in raw) {
    if (!isValidMemoryMiB(raw.memoryMiB)) {
      throw settingsInvalid("memoryMiB out of range", {
        min: SETTINGS_MEMORY_MIN_MIB,
        max: SETTINGS_MEMORY_MAX_MIB
      });
    }
    out.memoryMiB = raw.memoryMiB;
  }

  if ("reducedMotion" in raw) {
    if (typeof raw.reducedMotion !== "boolean") {
      throw settingsInvalid("reducedMotion must be boolean");
    }
    out.reducedMotion = raw.reducedMotion;
  }

  if (out.memoryMiB === undefined && out.reducedMotion === undefined) {
    throw settingsInvalid("update requires memoryMiB and/or reducedMotion");
  }

  return out;
}

export function applySettingsUpdate(current: SettingsDto, update: SettingsUpdateDto): SettingsDto {
  return {
    language: "fr",
    reducedMotion: update.reducedMotion ?? current.reducedMotion,
    memoryMiB:
      update.memoryMiB !== undefined
        ? update.memoryMiB
        : (current.memoryMiB ?? SETTINGS_MEMORY_DEFAULT_MIB)
  };
}

function settingsInvalid(
  _reason: string,
  details?: Record<string, string | number | boolean | null>
): UiError {
  return toUiError("SETTINGS_INVALID", "error.settings.invalid", details);
}
