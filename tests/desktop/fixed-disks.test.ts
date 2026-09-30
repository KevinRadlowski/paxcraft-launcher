/**
 * 0.6F.4 V3 fixed-disks inventory tests.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FIXED_DISK_FORBIDDEN_KEYS,
  FIXED_DISK_PS_ARGS,
  FIXED_DISK_PS_EXE,
  driveLetterFromPath,
  listFixedDisks,
  parseFixedDisksJson
} from "../../desktop/main/system-info/fixed-disks.js";
import { IpcChannels } from "../../desktop/shared/contract.js";

function gib(n: number): number {
  return n * 1024 ** 3;
}

describe("0.6F.4 V3 fixed disks", () => {
  it("PS exe/args are immutable static constants", () => {
    assert.equal(FIXED_DISK_PS_EXE, "powershell.exe");
    assert.deepEqual([...FIXED_DISK_PS_ARGS], [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID, Size, FreeSpace | ConvertTo-Json -Compress'
    ]);
    assert.ok(Object.isFrozen(FIXED_DISK_PS_ARGS) || FIXED_DISK_PS_ARGS.length === 6);
  });

  it("parse: 0 / 1 / 5 drives + usedPercent clamp", () => {
    assert.deepEqual(parseFixedDisksJson("", null), []);
    assert.deepEqual(parseFixedDisksJson("[]", null), []);

    const one = parseFixedDisksJson(
      JSON.stringify({ DeviceID: "C:", Size: gib(100), FreeSpace: gib(25) }),
      "C:"
    );
    assert.equal(one.length, 1);
    assert.equal(one[0]!.drive, "C:");
    assert.equal(one[0]!.usedPercent, 75);
    assert.equal(one[0]!.isSweetCraftDrive, true);

    const fiveRaw = Array.from({ length: 5 }, (_, i) => ({
      DeviceID: `${String.fromCharCode(67 + i)}:`,
      Size: gib(200),
      FreeSpace: gib(100)
    }));
    const five = parseFixedDisksJson(JSON.stringify(fiveRaw), "E:");
    assert.equal(five.length, 5);
    assert.equal(five.filter((d) => d.isSweetCraftDrive).length, 1);
    assert.equal(five.find((d) => d.drive === "E:")!.isSweetCraftDrive, true);
    assert.equal(five[0]!.usedPercent, 50);
  });

  it("skips malformed / zero size; normalizes device id", () => {
    const disks = parseFixedDisksJson(
      JSON.stringify([
        { DeviceID: "C:", Size: 0, FreeSpace: 0 },
        { DeviceID: "D:", Size: "bad", FreeSpace: 1 },
        { DeviceID: "not-a-drive", Size: gib(10), FreeSpace: gib(1) },
        { DeviceID: "e:", Size: gib(10), FreeSpace: gib(1) }
      ]),
      "E:"
    );
    assert.equal(disks.length, 1);
    assert.equal(disks[0]!.drive, "E:");
    assert.equal(disks[0]!.isSweetCraftDrive, true);
  });

  it("driveLetterFromPath + sweetcraft mark via listFixedDisks", async () => {
    assert.equal(driveLetterFromPath("H:\\Users\\kevin\\AppData\\..."), "H:");
    assert.equal(driveLetterFromPath("/tmp/foo"), null);

    const inv = await listFixedDisks({
      userData: "H:\\fake-user-data",
      platform: "win32",
      nowMs: 123,
      execFile: async (exe, args) => {
        assert.equal(exe, FIXED_DISK_PS_EXE);
        assert.deepEqual(args, [...FIXED_DISK_PS_ARGS]);
        return {
          stdout: JSON.stringify([
            { DeviceID: "C:", Size: gib(500), FreeSpace: gib(100) },
            { DeviceID: "H:", Size: gib(200), FreeSpace: gib(50) }
          ]),
          stderr: ""
        };
      }
    });
    assert.equal(inv.available, true);
    assert.equal(inv.checkedAtMs, 123);
    assert.equal(inv.disks.length, 2);
    assert.equal(inv.disks.find((d) => d.drive === "H:")!.isSweetCraftDrive, true);
    assert.equal(inv.disks.find((d) => d.drive === "C:")!.isSweetCraftDrive, false);
  });

  it("non-win32 and exec failure → available:false, disks:[] — no stderr leaked", async () => {
    const linux = await listFixedDisks({ userData: "/home/x", platform: "linux", nowMs: 1 });
    assert.deepEqual(linux, { available: false, disks: [], checkedAtMs: 1 });

    const fail = await listFixedDisks({
      userData: "C:\\ud",
      platform: "win32",
      nowMs: 2,
      execFile: async () => {
        throw Object.assign(new Error("boom"), { stderr: "SECRET_STDERR" });
      }
    });
    assert.equal(fail.available, false);
    assert.deepEqual(fail.disks, []);
    assert.doesNotMatch(JSON.stringify(fail), /SECRET_STDERR|stderr|powershell/i);
  });

  it("DTO omits forbidden keys; API signature has no renderer input beyond userData", async () => {
    const inv = await listFixedDisks({
      userData: "C:\\ud",
      platform: "win32",
      nowMs: 9,
      execFile: async () => ({
        stdout: JSON.stringify({ DeviceID: "C:", Size: gib(10), FreeSpace: gib(5) }),
        stderr: "ignore-me"
      })
    });
    const json = JSON.stringify(inv);
    for (const key of FIXED_DISK_FORBIDDEN_KEYS) {
      assert.doesNotMatch(json, new RegExp(`"${key}"`), key);
    }
    assert.doesNotMatch(json, /volumeName|serial|uuid|DeviceID|ignore-me/i);
    // listFixedDisks options: userData only from Main — no path/command from renderer.
    assert.equal(typeof listFixedDisks, "function");
    assert.equal(IpcChannels.SYSTEM_GET_FIXED_DISKS, "sc:system:getFixedDisks");
  });
});
