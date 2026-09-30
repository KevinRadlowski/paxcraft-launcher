/**
 * PACK-12B — player release manifest qualification (unsigned).
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  ReleaseQualifyError,
  RELEASE_SIGNING_STATUS,
  assertManifestMatchesSetup,
  buildPlayerReleaseManifest,
  defaultManifestOutPath,
  distributionChannelFromSemver,
  expectedSetupFilename,
  isPrereleaseSemver,
  ROOT,
  semverFromReleaseTag,
  sha256FileHex,
  writePlayerReleaseManifest
} from "../../scripts/release/manifest.mts";
import { readRootPackageVersion } from "../../scripts/version/lib.mts";

const COMMIT = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function stagingDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sc-player-release-"));
}

function writeSetup(dir: string, filename: string, bytes: Buffer): string {
  const p = path.join(dir, filename);
  fs.writeFileSync(p, bytes);
  return p;
}

describe("PACK-12B player release manifest", () => {
  it("expected setup filename uses product + semver + win-x64-setup.exe", () => {
    assert.equal(
      expectedSetupFilename("0.6.0-rc.18"),
      "SweetCraft Launcher-0.6.0-rc.18-win-x64-setup.exe"
    );
    assert.equal(
      expectedSetupFilename("1.0.0"),
      "SweetCraft Launcher-1.0.0-win-x64-setup.exe"
    );
  });

  it("distribution channel from semver", () => {
    assert.equal(distributionChannelFromSemver("0.6.0-rc.18"), "rc");
    assert.equal(distributionChannelFromSemver("1.0.0"), "stable");
    assert.equal(distributionChannelFromSemver("1.0.0-beta.1"), "internal");
    assert.equal(distributionChannelFromSemver("1.0.0-alpha.2"), "internal");
    assert.equal(isPrereleaseSemver("0.6.0-rc.18"), true);
    assert.equal(isPrereleaseSemver("1.0.0"), false);
    assert.equal(semverFromReleaseTag("v0.6.0-rc.18"), "0.6.0-rc.18");
    assert.equal(semverFromReleaseTag("0.6.0"), "0.6.0");
  });

  it("happy path with temp fake setup + clean provenanceOverride", () => {
    const dir = stagingDir();
    try {
      const semver = readRootPackageVersion(ROOT);
      const bytes = Buffer.from("sweetcraft-fake-setup-bytes-not-empty");
      const setupPath = writeSetup(dir, expectedSetupFilename(semver), bytes);
      const commit = COMMIT;
      const manifest = buildPlayerReleaseManifest({
        setupPath,
        expectedCommit: commit,
        provenanceOverride: {
          commit,
          dirty: false,
          buildId: `${semver}@${commit.slice(0, 12)}`
        }
      });
      assert.equal(manifest.schemaVersion, 1);
      assert.equal(manifest.product, "SweetCraft Launcher");
      assert.equal(manifest.semver, semver);
      assert.equal(manifest.dirty, false);
      assert.equal(manifest.platform, "win32");
      assert.equal(manifest.arch, "x64");
      assert.equal(manifest.signing.status, RELEASE_SIGNING_STATUS);
      assert.equal(manifest.signing.status, "unsigned");
      assert.equal(manifest.buildCommit, commit);
      assert.equal(manifest.buildId, `${semver}@${commit.slice(0, 12)}`);
      assert.equal(manifest.artifact.filename, expectedSetupFilename(semver));
      assert.ok(manifest.createdAt.includes("T"));
      assert.ok(!Number.isNaN(Date.parse(manifest.createdAt)));

      const independentSha = crypto.createHash("sha256").update(bytes).digest("hex");
      assert.equal(manifest.artifact.sha256, independentSha);
      assert.equal(manifest.artifact.sha256, sha256FileHex(setupPath));
      assert.equal(manifest.artifact.sizeBytes, bytes.length);
      assert.notEqual(manifest.artifact.sizeBytes, 0);

      const out = writePlayerReleaseManifest(manifest, defaultManifestOutPath(setupPath), setupPath);
      assert.ok(fs.existsSync(out));
      assertManifestMatchesSetup(manifest, setupPath);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects dirty provenance", () => {
    const dir = stagingDir();
    try {
      const semver = readRootPackageVersion(ROOT);
      const setupPath = writeSetup(dir, expectedSetupFilename(semver), Buffer.from("abc"));
      assert.throws(
        () =>
          buildPlayerReleaseManifest({
            setupPath,
            expectedCommit: COMMIT,
            provenanceOverride: {
              commit: COMMIT,
              dirty: true,
              buildId: `${semver}@${COMMIT.slice(0, 12)}`
            }
          }),
        ReleaseQualifyError
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects wrong commit", () => {
    const dir = stagingDir();
    try {
      const semver = readRootPackageVersion(ROOT);
      const setupPath = writeSetup(dir, expectedSetupFilename(semver), Buffer.from("abc"));
      const other = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
      assert.throws(
        () =>
          buildPlayerReleaseManifest({
            setupPath,
            expectedCommit: other,
            provenanceOverride: {
              commit: COMMIT,
              dirty: false,
              buildId: `${semver}@${COMMIT.slice(0, 12)}`
            }
          }),
        ReleaseQualifyError
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects wrong tag/semver", () => {
    const dir = stagingDir();
    try {
      const semver = readRootPackageVersion(ROOT);
      const setupPath = writeSetup(dir, expectedSetupFilename(semver), Buffer.from("abc"));
      assert.throws(
        () =>
          buildPlayerReleaseManifest({
            setupPath,
            expectedCommit: COMMIT,
            expectedSemverFromTag: "v9.9.9",
            provenanceOverride: {
              commit: COMMIT,
              dirty: false,
              buildId: `${semver}@${COMMIT.slice(0, 12)}`
            }
          }),
        ReleaseQualifyError
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects missing setup", () => {
    const semver = readRootPackageVersion(ROOT);
    const missing = path.join(os.tmpdir(), "sc-missing", expectedSetupFilename(semver));
    assert.throws(
      () =>
        buildPlayerReleaseManifest({
          setupPath: missing,
          expectedCommit: COMMIT,
          provenanceOverride: {
            commit: COMMIT,
            dirty: false,
            buildId: `${semver}@${COMMIT.slice(0, 12)}`
          }
        }),
      ReleaseQualifyError
    );
  });

  it("rejects wrong filename", () => {
    const dir = stagingDir();
    try {
      const semver = readRootPackageVersion(ROOT);
      const setupPath = writeSetup(dir, "not-the-official-setup.exe", Buffer.from("abc"));
      assert.throws(
        () =>
          buildPlayerReleaseManifest({
            setupPath,
            expectedCommit: COMMIT,
            provenanceOverride: {
              commit: COMMIT,
              dirty: false,
              buildId: `${semver}@${COMMIT.slice(0, 12)}`
            }
          }),
        ReleaseQualifyError
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects size 0 empty file", () => {
    const dir = stagingDir();
    try {
      const semver = readRootPackageVersion(ROOT);
      const setupPath = writeSetup(dir, expectedSetupFilename(semver), Buffer.alloc(0));
      assert.throws(
        () =>
          buildPlayerReleaseManifest({
            setupPath,
            expectedCommit: COMMIT,
            provenanceOverride: {
              commit: COMMIT,
              dirty: false,
              buildId: `${semver}@${COMMIT.slice(0, 12)}`
            }
          }),
        ReleaseQualifyError
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("signing is unsigned and createdAt is ISO", () => {
    const dir = stagingDir();
    try {
      const semver = readRootPackageVersion(ROOT);
      const setupPath = writeSetup(dir, expectedSetupFilename(semver), Buffer.from("xyz"));
      const createdAt = "2026-09-19T00:00:00.000Z";
      const manifest = buildPlayerReleaseManifest({
        setupPath,
        expectedCommit: COMMIT,
        createdAt,
        provenanceOverride: {
          commit: COMMIT,
          dirty: false,
          buildId: `${semver}@${COMMIT.slice(0, 12)}`
        }
      });
      assert.equal(manifest.signing.status, "unsigned");
      assert.equal(manifest.createdAt, createdAt);
      assert.equal(new Date(manifest.createdAt).toISOString(), createdAt);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
