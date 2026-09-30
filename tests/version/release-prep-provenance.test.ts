/**
 * PACK-12G — clean release prep sequence must stay provenance-clean (no +dirty).
 * Uses a temporary git worktree + this pack's fixed sync APIs (imported from WIP).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  isProductAffectingPorcelainEntry,
  isWorktreeProductDirtyFromPorcelain,
  parseGitPorcelainLine,
  parseLauncherVersion,
  readGeneratedBuildId,
  readGitBuildInfo,
  readRootPackageVersion,
  syncElectronBuilderBuildVersion,
  syncRootPackageDerivedFields,
  syncUiPackageVersion,
  writeBuildGeneratedFiles,
  writeGeneratedFiles
} from "../../scripts/version/lib.mts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).replace(/\n$/, "");
}

/** Mirror version:check refresh + version:generate sync using fixed APIs. */
function runReleasePrep(wt: string): void {
  const semver = readRootPackageVersion(wt);
  const info = parseLauncherVersion(semver);

  // version:check refresh of build twins
  let buildInfo = readGitBuildInfo(wt, info.semver);
  writeBuildGeneratedFiles(wt, buildInfo);

  // version:generate: SemVer modules + build + idempotent syncs
  writeGeneratedFiles(wt, info);
  buildInfo = readGitBuildInfo(wt, info.semver);
  writeBuildGeneratedFiles(wt, buildInfo);
  syncRootPackageDerivedFields(wt, info);
  syncUiPackageVersion(wt, info);
  syncElectronBuilderBuildVersion(wt, info);

  // trailing version:check refresh
  buildInfo = readGitBuildInfo(wt, info.semver);
  writeBuildGeneratedFiles(wt, buildInfo);
}

describe("PACK-12G clean release preparation provenance", () => {
  it("check → generate → check stays clean on a pristine worktree (no +dirty)", () => {
    const head = git(ROOT, ["rev-parse", "HEAD"]);
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "sc-rel-prep-"));
    const wt = path.join(work, "wt");
    try {
      git(ROOT, ["worktree", "add", "--detach", wt, head]);

      runReleasePrep(wt);

      const status = git(wt, ["status", "--porcelain=v1"]);
      for (const line of status.split(/\n/).filter(Boolean)) {
        assert.doesNotMatch(line, /(?:^|\s)(?:ui\/)?package\.json$/);
        assert.doesNotMatch(line, /electron-builder\.yml$/);
      }

      const affecting = status
        .split(/\n/)
        .map((l) => l.replace(/\r$/, ""))
        .filter(Boolean)
        .filter((line) => {
          const e = parseGitPorcelainLine(line);
          return e ? isProductAffectingPorcelainEntry(e) : false;
        });
      assert.equal(isWorktreeProductDirtyFromPorcelain(status), false);
      assert.deepEqual(affecting, [], `unexpected product dirt:\n${JSON.stringify(status)}`);

      const semver = readRootPackageVersion(wt);
      const info = readGitBuildInfo(wt, semver);
      assert.equal(info.dirty, false);
      assert.doesNotMatch(info.buildId, /\+dirty$/);
      assert.equal(info.commit, head);

      const fromDisk = readGeneratedBuildId(path.join(wt, "src/build.generated.ts"));
      assert.equal(fromDisk, info.buildId);
      assert.doesNotMatch(fromDisk, /\+dirty$/);
    } finally {
      try {
        git(ROOT, ["worktree", "remove", "--force", wt]);
      } catch {
        try {
          fs.rmSync(wt, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
      fs.rmSync(work, { recursive: true, force: true });
    }
  });

  it("package.json desktop:package:builder forces --publish never", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    assert.match(pkg.scripts["desktop:package:builder"] ?? "", /--publish\s+never/);
  });
});
