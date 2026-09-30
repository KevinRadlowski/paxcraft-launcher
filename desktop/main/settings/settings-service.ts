/**
 * SettingsDesktopService — Main-owned get/update with in-memory cache + disk persistence.
 */

import fs from "node:fs";
import type { SettingsDto } from "../../shared/contract.js";
import {
  applySettingsUpdate,
  assertSettingsUpdatePayload,
  type SettingsUpdateDto
} from "./settings-dto.js";
import {
  DEFAULT_SETTINGS,
  loadSettingsStore,
  saveSettingsStore,
  settingsFilePath
} from "./settings-store.js";

export class SettingsDesktopService {
  private cached: SettingsDto;

  constructor(private readonly dataDir: string) {
    this.cached = loadSettingsStore(dataDir);
  }

  get(): SettingsDto {
    return { ...this.cached };
  }

  getPersistedInstancePath(): string | null | undefined {
    return loadSettingsStore(this.dataDir).sweetcraftInstancePath;
  }

  setPersistedInstancePath(instancePath: string): void {
    const current = loadSettingsStore(this.dataDir);
    saveSettingsStore(this.dataDir, {
      ...current,
      sweetcraftInstancePath: instancePath
    });
    this.cached = loadSettingsStore(this.dataDir);
  }

  /** Current memory for next play launch (no process restart required). */
  getMemoryMiB(): number | undefined {
    return this.cached.memoryMiB;
  }

  update(raw: unknown): SettingsDto {
    const patch = assertSettingsUpdatePayload(raw);
    const next = applySettingsUpdate(this.cached, patch);
    saveSettingsStore(this.dataDir, next);
    this.cached = next;
    return { ...this.cached };
  }

  /** Ensure defaults file exists on first launch. */
  ensurePersistedDefaults(): void {
    const file = settingsFilePath(this.dataDir);
    if (!fs.existsSync(file)) {
      saveSettingsStore(this.dataDir, { ...DEFAULT_SETTINGS });
      this.cached = { ...DEFAULT_SETTINGS };
    }
  }

  /** Test helper: replace cache from disk. */
  reloadFromDisk(): SettingsDto {
    this.cached = loadSettingsStore(this.dataDir);
    return this.get();
  }
}

export function createSettingsDesktopService(dataDir: string): SettingsDesktopService {
  const svc = new SettingsDesktopService(dataDir);
  svc.ensurePersistedDefaults();
  return svc;
}

export type { SettingsUpdateDto };
