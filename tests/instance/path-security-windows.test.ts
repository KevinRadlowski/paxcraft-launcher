/**
 * PACK-12F.2 — Windows path identity / containment (short vs long names).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { ErrorCode, LauncherError } from "../../src/core/errors/index.js";
import { InstancePaths } from "../../src/instance/layout/index.js";
import {
  isCanonicallyInside,
  isPathInside,
  resolveSafeInstancePath,
  tryRealpath
} from "../../src/instance/security/index.js";

function windowsShortPath(longPath: string): string | null {
  if (process.platform !== "win32") return null;
  try {
    const ps = `
      Add-Type -Namespace Win -Name Native -MemberDefinition @"
        [System.Runtime.InteropServices.DllImport("kernel32.dll", CharSet=System.Runtime.InteropServices.CharSet.Unicode, SetLastError=true)]
        public static extern int GetShortPathNameW(string lpszLongPath, System.Text.StringBuilder lpszShortPath, int cchBuffer);
"@
      $sb = New-Object System.Text.StringBuilder 512
      [void][Win.Native]::GetShortPathNameW('${longPath.replace(/'/g, "''")}', $sb, $sb.Capacity)
      $sb.ToString()
    `;
    const out = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-Command", ps],
      { encoding: "utf8" }
    ).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

describe("PACK-12F.2 path containment / Windows identity", () => {
  it("lexical isPathInside does not equate 8.3 alias with long name (documents false-positive)", () => {
    const shortRoot = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\sc-x\\instance";
    const longChild = "C:\\Users\\runneradmin\\AppData\\Local\\Temp\\sc-x\\instance\\mods";
    assert.equal(isPathInside(shortRoot, longChild), false);
    assert.equal(
      path.relative(shortRoot, longChild).startsWith("..") ||
        path.relative(shortRoot, longChild).includes(".."),
      true
    );
  });

  it("normal descendant accepted; sibling and traversal rejected", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "sc-sec-"));
    try {
      const root = path.join(base, "instance");
      await mkdir(path.join(root, "mods"), { recursive: true });
      await writeFile(path.join(root, "mods", "a.jar"), "x");
      const paths = new InstancePaths(root);
      const ok = await resolveSafeInstancePath(paths, "mods/a.jar");
      assert.equal(ok, path.resolve(root, "mods", "a.jar"));

      await assert.rejects(
        () => resolveSafeInstancePath(paths, "mods/../outside.jar"),
        (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.UNSAFE_PATH
      );

      const siblingRoot = path.join(base, "instance2");
      await mkdir(siblingRoot, { recursive: true });
      assert.equal(isPathInside(root, path.join(siblingRoot, "mods")), false);
      assert.equal(await isCanonicallyInside(root, path.join(siblingRoot, "mods")), false);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("non-existing safe descendant under verified ancestors is accepted", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "sc-sec-miss-"));
    try {
      const root = path.join(base, "instance");
      await mkdir(path.join(root, "mods"), { recursive: true });
      const paths = new InstancePaths(root);
      const abs = await resolveSafeInstancePath(paths, "mods/not-yet-written.jar");
      assert.equal(abs, path.resolve(root, "mods", "not-yet-written.jar"));
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("symlink/junction escape rejected when creatable", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "sc-sec-link-"));
    try {
      const root = path.join(base, "instance");
      const outside = path.join(base, "outside");
      await mkdir(outside, { recursive: true });
      await mkdir(root, { recursive: true });
      const link = path.join(root, "mods");
      try {
        await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
      } catch {
        return; // privilege / platform limitation
      }
      const paths = new InstancePaths(root);
      await assert.rejects(
        () => resolveSafeInstancePath(paths, "mods/x.jar"),
        (e: unknown) =>
          e instanceof LauncherError &&
          (e.code === ErrorCode.SYMLINK_ESCAPE || e.code === ErrorCode.UNSAFE_PATH)
      );
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("Windows short-name root accepts realpath children (false-positive fix)", async (t) => {
    if (process.platform !== "win32") {
      t.skip("Windows-only short-name alias");
      return;
    }

    // Stable system short/long alias (no temp 8.3 required).
    const shortRoot = "C:\\PROGRA~1";
    const longChild = "C:\\Program Files\\Windows NT";
    assert.equal(isPathInside(shortRoot, longChild), false, "lexical short≠long is the CI false-positive");
    assert.equal(await isCanonicallyInside(shortRoot, longChild), true);

    const baseLong = await mkdtemp(path.join(os.tmpdir(), "sc-sec-short-"));
    try {
      const rootLong = path.join(baseLong, "instance");
      await mkdir(path.join(rootLong, "mods"), { recursive: true });
      await writeFile(path.join(rootLong, "mods", "a.jar"), "x");

      const rootShort = windowsShortPath(rootLong);
      if (rootShort && path.resolve(rootShort).toLowerCase() !== path.resolve(rootLong).toLowerCase()) {
        assert.equal(isPathInside(rootShort, path.join(rootLong, "mods")), false);
        assert.equal(await isCanonicallyInside(rootShort, path.join(rootLong, "mods")), true);
        const paths = new InstancePaths(rootShort);
        const abs = await resolveSafeInstancePath(paths, "mods/a.jar");
        assert.ok(abs.toLowerCase().endsWith(`${path.sep}mods${path.sep}a.jar`.toLowerCase()));
      } else {
        // Volume without per-dir 8.3: still exercise resolve under long root.
        const paths = new InstancePaths(rootLong);
        const abs = await resolveSafeInstancePath(paths, "mods/a.jar");
        assert.equal(abs, path.resolve(rootLong, "mods", "a.jar"));
        const rp = await tryRealpath(rootLong);
        assert.ok(rp);
      }
    } finally {
      await rm(baseLong, { recursive: true, force: true });
    }
  });
});
