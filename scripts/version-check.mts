/**
 * pnpm version:check — fail if generated metadata / duplicates are stale or invalid.
 *
 * Optional: SWEETCRAFT_REQUIRE_LEGAL_IDENTITY=1 fails when package.json author is missing
 * (public signed release gate). Internal builds leave this unset.
 */
import fs from "node:fs";
import path from "node:path";
import {
  ROOT,
  BUILD_GENERATED_PATHS,
  GENERATED_PATHS,
  parseLauncherVersion,
  readGitBuildInfo,
  readRootPackageVersion,
  readGeneratedBuildId,
  readGeneratedLauncherVersion,
  readGeneratedWindowsVersion,
  renderBuildGeneratedTypeScript,
  renderGeneratedTypeScript,
  writeBuildGeneratedFiles,
  hasLegalPublisherIdentity,
  VersionError
} from "./version/lib.mts";

function fail(msg: string): never {
  console.error(`version:check FAIL: ${msg}`);
  process.exit(1);
}

/** Git checkout on Windows may introduce CRLF; generated contract is LF-only. */
function normalizeGeneratedBody(body: string): string {
  return body.replace(/\r\n/g, "\n");
}

try {
  const semver = readRootPackageVersion(ROOT);
  const info = parseLauncherVersion(semver);
  const expectedBody = renderGeneratedTypeScript(info);

  /**
   * Build provenance embeds git HEAD. It cannot be a commit-stable SoT:
   * regenerating then committing always leaves the next HEAD stale (self-reference).
   * Refresh from the checked-out HEAD before verifying; SemVer modules stay strict.
   */
  const buildInfo = readGitBuildInfo(ROOT, info.semver);
  const expectedBuildBody = renderBuildGeneratedTypeScript(buildInfo);
  let buildRefreshed = false;
  for (const rel of Object.values(BUILD_GENERATED_PATHS)) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
      buildRefreshed = true;
      break;
    }
    const actual = normalizeGeneratedBody(fs.readFileSync(abs, "utf8"));
    if (actual !== expectedBuildBody) {
      buildRefreshed = true;
      break;
    }
  }
  if (buildRefreshed) {
    writeBuildGeneratedFiles(ROOT, buildInfo);
    console.log(
      `version:check: refreshed build provenance from HEAD (${buildInfo.buildId})`
    );
  }

  for (const rel of Object.values(BUILD_GENERATED_PATHS)) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) fail(`missing generated file ${rel} (run pnpm version:generate)`);
    const actual = normalizeGeneratedBody(fs.readFileSync(abs, "utf8"));
    if (actual !== expectedBuildBody) {
      fail(`${rel} does not match git HEAD after refresh`);
    }
    if (readGeneratedBuildId(abs) !== buildInfo.buildId) {
      fail(`${rel} LAUNCHER_BUILD_ID mismatch`);
    }
  }

  for (const rel of Object.values(GENERATED_PATHS)) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) fail(`missing generated file ${rel} (run pnpm version:generate)`);
    const actual = normalizeGeneratedBody(fs.readFileSync(abs, "utf8"));
    if (actual !== expectedBody) {
      fail(`${rel} is stale vs package.json ${semver} (run pnpm version:generate)`);
    }
    if (readGeneratedLauncherVersion(abs) !== info.semver) {
      fail(`${rel} LAUNCHER_VERSION mismatch`);
    }
    if (readGeneratedWindowsVersion(abs) !== info.windowsVersion) {
      fail(`${rel} WINDOWS_FILE_VERSION mismatch`);
    }
  }

  const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
    version: string;
    shortVersion?: string;
    shortVersionWindows?: string;
  };
  if (rootPkg.shortVersion !== info.windowsVersion) {
    fail(`package.json shortVersion=${rootPkg.shortVersion} expected ${info.windowsVersion}`);
  }
  if (rootPkg.shortVersionWindows !== info.windowsVersion) {
    fail(
      `package.json shortVersionWindows=${rootPkg.shortVersionWindows} expected ${info.windowsVersion}`
    );
  }

  const uiPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "ui", "package.json"), "utf8")) as {
    version: string;
  };
  if (uiPkg.version !== info.semver) {
    fail(`ui/package.json version=${uiPkg.version} expected ${info.semver} (synced copy only)`);
  }

  const yml = fs.readFileSync(path.join(ROOT, "electron-builder.yml"), "utf8");
  if (!new RegExp(`^buildVersion:\\s*${info.windowsVersion.replace(/\./g, "\\.")}\\s*$`, "m").test(yml)) {
    fail(`electron-builder.yml buildVersion must be ${info.windowsVersion}`);
  }

  // Forbidden manual product-version literals in product/version hand-maintained modules
  const productTs = fs.readFileSync(path.join(ROOT, "desktop", "shared", "product.ts"), "utf8");
  if (/DESKTOP_PRODUCT_VERSION\s*=\s*["']/.test(productTs)) {
    fail("desktop/shared/product.ts must not hardcode DESKTOP_PRODUCT_VERSION string");
  }
  const versionTs = fs.readFileSync(path.join(ROOT, "src", "version.ts"), "utf8");
  if (/LAUNCHER_VERSION\s*=\s*["']/.test(versionTs)) {
    fail("src/version.ts must not hardcode LAUNCHER_VERSION string");
  }

  if (process.env.SWEETCRAFT_REQUIRE_LEGAL_IDENTITY === "1") {
    if (!hasLegalPublisherIdentity(ROOT)) {
      fail(
        "LEGAL_IDENTITY_REQUIRED: package.json author.name missing (public signed release gate)"
      );
    }
  }

  console.log(`version:check OK`);
  console.log(`  semver=${info.semver}`);
  console.log(`  windows=${info.windowsVersion}`);
  console.log(`  buildId=${buildInfo.buildId}`);
  console.log(`  legalIdentity=${hasLegalPublisherIdentity(ROOT) ? "present" : "absent"}`);
} catch (e) {
  if (e instanceof VersionError) fail(e.message);
  throw e;
}
