/**
 * pnpm version:generate — regenerate version modules from root package.json.
 */
import fs from "node:fs";
import path from "node:path";
import {
  ROOT,
  parseLauncherVersion,
  readGitBuildInfo,
  readRootPackageVersion,
  syncRootPackageDerivedFields,
  syncUiPackageVersion,
  syncElectronBuilderBuildVersion,
  writeBuildGeneratedFiles,
  writeGeneratedFiles,
  VersionError
} from "./version/lib.mts";

try {
  const semver = readRootPackageVersion(ROOT);
  const info = parseLauncherVersion(semver);
  const written = writeGeneratedFiles(ROOT, info);
  const buildInfo = readGitBuildInfo(ROOT, info.semver);
  const buildWritten = writeBuildGeneratedFiles(ROOT, buildInfo);
  const syncedRoot = syncRootPackageDerivedFields(ROOT, info);
  const syncedUi = syncUiPackageVersion(ROOT, info);
  const syncedYml = syncElectronBuilderBuildVersion(ROOT, info);

  console.log(`version:generate OK`);
  console.log(`  semver=${info.semver}`);
  console.log(`  windows=${info.windowsVersion}`);
  console.log(`  buildId=${buildInfo.buildId}`);
  console.log(`  wrote=${written.concat(buildWritten).join(", ")}`);
  console.log(
    `  synced=package.json:${syncedRoot}/ui:${syncedUi}/electron-builder:${syncedYml}`
  );
} catch (e) {
  const msg = e instanceof VersionError || e instanceof Error ? e.message : String(e);
  console.error(`version:generate FAIL: ${msg}`);
  process.exit(1);
}
