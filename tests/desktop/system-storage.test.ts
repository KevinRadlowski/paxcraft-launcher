/**
 * 0.6F.4 system-info + storage safety tests.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  SYSTEM_INFO_FORBIDDEN_KEYS,
  buildOsLabel,
  collectSystemInfo,
  recommendMemoryMiB
} from "../../desktop/main/system-info/system-info.js";
import {
  STORAGE_DTO_FORBIDDEN_KEYS,
  getStorageSummary,
  openStorageTarget,
  resolveSweetCraftStoragePaths
} from "../../desktop/main/storage/storage-actions.js";
import { IpcChannels } from "../../desktop/shared/contract.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("0.6F.4 memory recommendation", () => {
  it("returns null when total unknown", () => {
    assert.equal(recommendMemoryMiB(null), null);
    assert.equal(recommendMemoryMiB(undefined), null);
    assert.equal(recommendMemoryMiB(0), null);
  });

  it("applies 35% floor/cap formula on 512 steps", () => {
    // 8 GiB → 0.35*8192=2867.2 → floor to 2560 → max(2048,2560)=2560 → min(8192)=2560
    assert.equal(recommendMemoryMiB(8192), 2560);
    // 16 GiB → 0.35*16384=5734.4 → 5632 → capped by 8192 → 5632
    assert.equal(recommendMemoryMiB(16384), 5632);
    // 32 GiB → 0.35*32768=11468.8 → 11264 → min(8192)=8192
    assert.equal(recommendMemoryMiB(32768), 8192);
    // 4 GiB → 0.35*4096=1433.6 → 1024 → max(2048,1024)=2048
    assert.equal(recommendMemoryMiB(4096), 2048);
  });
});

describe("0.6F.4 system info DTO safety", () => {
  it("os label never includes hostname/username patterns", () => {
    assert.equal(buildOsLabel("win32", "10.0.26200"), "Windows 10+");
    assert.match(buildOsLabel("darwin", "24.0.0") ?? "", /^macOS/);
    assert.match(buildOsLabel("linux", "6.8.0") ?? "", /^Linux/);
  });

  it("collectSystemInfo omits forbidden sensitive fields and leaves disk null", async () => {
    const dto = await collectSystemInfo({
      launcherVersion: "0.6.0-rc.18",
      diskProbePath: "C:\\should-be-ignored",
      nowMs: 1_700_000_000_000,
      osApi: {
        platform: () => "win32",
        arch: () => "x64",
        release: () => "10.0.26200",
        cpus: () => [{ model: "Test CPU" }],
        totalmem: () => 16 * 1024 * 1024 * 1024,
        freemem: () => 8 * 1024 * 1024 * 1024
      }
    });
    assert.equal(dto.available, true);
    assert.equal(dto.platform, "win32");
    assert.equal(dto.totalMemoryMiB, 16384);
    assert.equal(dto.recommendedMemoryMiB, 5632);
    assert.equal(dto.launcherVersion, "0.6.0-rc.18");
    // Multi-disk is separate IPC — getInfo never populates disk.
    assert.equal(dto.diskTotalGiB, null);
    assert.equal(dto.diskFreeGiB, null);
    const json = JSON.stringify(dto);
    for (const key of SYSTEM_INFO_FORBIDDEN_KEYS) {
      assert.equal(Object.prototype.hasOwnProperty.call(dto, key), false, key);
      assert.doesNotMatch(json, new RegExp(`"${key}"`));
    }
    assert.doesNotMatch(json, /hostname|username|homedir|USERPROFILE/i);
  });
});

describe("0.6F.4 storage actions", () => {
  it("summary exposes semantic flags and optional instancePath for Settings", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-storage-"));
    const paths = resolveSweetCraftStoragePaths(dir);
    fs.mkdirSync(paths.instancePath, { recursive: true });
    const summary = getStorageSummary(dir);
    assert.equal(summary.instanceAvailable, true);
    assert.equal(summary.logsAvailable, true);
    assert.equal(summary.launcherDataAvailable, true);
    assert.equal(typeof summary.instancePath, "string");
    assert.equal(summary.instanceLocationConfigured, false);
    assert.equal(summary.instanceLocationAvailable, true);
    const json = JSON.stringify(summary);
    for (const key of STORAGE_DTO_FORBIDDEN_KEYS) {
      assert.equal(Object.prototype.hasOwnProperty.call(summary, key), false, key);
      assert.doesNotMatch(json, new RegExp(`"${key}"`));
    }
  });

  it("open rejects missing instance and never takes renderer path", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-storage-"));
    const opened: string[] = [];
    const missing = await openStorageTarget({
      userData: dir,
      target: "instance",
      openPath: async (p) => {
        opened.push(p);
        return "";
      }
    });
    assert.equal(missing.opened, false);
    assert.equal(missing.unavailable, true);
    assert.equal(opened.length, 0);

    const paths = resolveSweetCraftStoragePaths(dir);
    fs.mkdirSync(paths.instancePath, { recursive: true });
    const ok = await openStorageTarget({
      userData: dir,
      target: "instance",
      openPath: async (p) => {
        opened.push(p);
        return "";
      }
    });
    assert.equal(ok.opened, true);
    assert.equal(opened.length, 1);
    assert.equal(opened[0], paths.instancePath);
    assert.doesNotMatch(JSON.stringify(ok), /instances|path|userData/);
  });

  it("renderer API has no path parameter (preload + contract)", () => {
    const preload = readFileSync(path.join(root, "desktop/preload/preload.cjs"), "utf8");
    assert.match(preload, /STORAGE_OPEN_INSTANCE/);
    assert.match(preload, /openInstance:\s*\(\)\s*=>\s*invoke/);
    assert.match(preload, /openLogs:\s*\(\)\s*=>\s*invoke/);
    assert.doesNotMatch(preload, /openInstance:\s*\([^)]*path/);
    assert.doesNotMatch(preload, /openLogs:\s*\([^)]*path/);
    assert.equal(IpcChannels.SYSTEM_GET_INFO, "sc:system:getInfo");
    assert.equal(IpcChannels.SYSTEM_GET_FIXED_DISKS, "sc:system:getFixedDisks");
    assert.equal(IpcChannels.STORAGE_GET_SUMMARY, "sc:storage:getSummary");
    assert.equal(IpcChannels.STORAGE_OPEN_INSTANCE, "sc:storage:openInstance");
    assert.equal(IpcChannels.STORAGE_OPEN_LOGS, "sc:storage:openLogs");
  });
});
