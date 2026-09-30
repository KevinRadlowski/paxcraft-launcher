/**
 * Settings persistence + IPC validation tests (0.6E).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  SETTINGS_MEMORY_DEFAULT_MIB,
  SETTINGS_MEMORY_MAX_MIB,
  SETTINGS_MEMORY_MIN_MIB,
  createSettingsDesktopService,
  loadSettingsStore,
  parsePersistedSettings,
  saveSettingsStore,
  settingsFilePath,
  assertSettingsUpdatePayload,
  applySettingsUpdate
} from "../../desktop/main/settings/index.js";

describe("0.6E settings store", () => {
  it("defaults on first launch", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-settings-"));
    const svc = createSettingsDesktopService(dir);
    const dto = svc.get();
    assert.equal(dto.language, "fr");
    assert.equal(dto.reducedMotion, false);
    assert.equal(dto.memoryMiB, SETTINGS_MEMORY_DEFAULT_MIB);
    assert.ok(fs.existsSync(settingsFilePath(dir)));
  });

  it("persists memory setting", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-settings-"));
    const svc = createSettingsDesktopService(dir);
    svc.update({ memoryMiB: 4096 });
    const reloaded = loadSettingsStore(dir);
    assert.equal(reloaded.memoryMiB, 4096);
  });

  it("malformed settings fail safely", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-settings-"));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(settingsFilePath(dir), "{not-json", "utf8");
    const dto = loadSettingsStore(dir);
    assert.equal(dto.memoryMiB, SETTINGS_MEMORY_DEFAULT_MIB);
  });

  it("schema validation rejects unknown schema", () => {
    const parsed = parsePersistedSettings({ schemaVersion: 99, memoryMiB: 99999 });
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.memoryMiB, SETTINGS_MEMORY_DEFAULT_MIB);
  });

  it("atomic write behavior", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-settings-"));
    saveSettingsStore(dir, {
      language: "fr",
      reducedMotion: true,
      memoryMiB: 6144
    });
    const text = fs.readFileSync(settingsFilePath(dir), "utf8");
    assert.ok(text.includes('"memoryMiB": 6144'));
    assert.ok(!fs.readdirSync(dir).some((f) => f.endsWith(".tmp")));
  });

  it("memory below min rejected", () => {
    assert.throws(() => assertSettingsUpdatePayload({ memoryMiB: 256 }));
    assert.throws(() => assertSettingsUpdatePayload({ memoryMiB: SETTINGS_MEMORY_MIN_MIB - 1 }));
  });

  it("memory above max rejected", () => {
    assert.throws(() => assertSettingsUpdatePayload({ memoryMiB: SETTINGS_MEMORY_MAX_MIB + 1 }));
  });

  it("non-number memory rejected", () => {
    assert.throws(() => assertSettingsUpdatePayload({ memoryMiB: "4096" as unknown as number }));
    assert.throws(() => assertSettingsUpdatePayload({ memoryMiB: 4096.5 }));
  });

  it("renderer cannot set arbitrary setting", () => {
    assert.throws(() => assertSettingsUpdatePayload({ channel: "dev" }));
    assert.throws(() => assertSettingsUpdatePayload({ foo: 1 }));
  });

  it("renderer cannot inject JVM args", () => {
    assert.throws(() => assertSettingsUpdatePayload({ extraJvmArgs: ["-Xmx8G"] }));
    assert.throws(() => assertSettingsUpdatePayload({ jvmArgs: "-Xmx8G" }));
  });

  it("renderer cannot inject Java path", () => {
    assert.throws(() => assertSettingsUpdatePayload({ javaPath: "C:\\\\Java\\\\bin\\\\java.exe" }));
    assert.throws(() => assertSettingsUpdatePayload({ javaExecutable: "/usr/bin/java" }));
  });

  it("setting survives service recreation", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-settings-"));
    const a = createSettingsDesktopService(dir);
    a.update({ memoryMiB: 8192, reducedMotion: true });
    const b = createSettingsDesktopService(dir);
    assert.equal(b.get().memoryMiB, 8192);
    assert.equal(b.get().reducedMotion, true);
  });

  it("apply update merges without restart requirement for memory getter", () => {
    const current = { language: "fr" as const, reducedMotion: false, memoryMiB: 2048 };
    const next = applySettingsUpdate(current, { memoryMiB: 4096 });
    assert.equal(next.memoryMiB, 4096);
    // Documented behavior: editable while RUNNING; applied to NEXT launch via getMemoryMiB.
  });
});
