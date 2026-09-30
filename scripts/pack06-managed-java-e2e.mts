/**
 * PACK-06 live managed-Java E2E (downloads real Temurin).
 * Usage: pnpm exec tsx scripts/pack06-managed-java-e2e.mts
 */
import { mkdir, rm, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FetchHttpClient } from "../src/distribution/http/index.js";
import { FetchByteSource } from "../src/download/engine/sources.js";
import { ensureCompatibleJava } from "../src/java/provision/index.js";
import { readManagedJavaMeta } from "../src/java/provision/meta.js";
import { RuntimePaths } from "../src/minecraft/runtime/paths.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const E2E = path.join(ROOT, "..", "E2E", "SweetCraft-ManagedJava-0.6.0-rc.17");
const runtimeRoot = path.join(E2E, "launcher-data", "runtime");

async function main(): Promise<void> {
  await rm(E2E, { recursive: true, force: true });
  await mkdir(runtimeRoot, { recursive: true });

  const http = new FetchHttpClient();
  const bytes = new FetchByteSource();

  console.log("=== FIRST ensureCompatibleJava (skip system, live Adoptium) ===");
  const t0 = Date.now();
  const first = await ensureCompatibleJava({
    requirement: { majorVersion: 25 },
    runtimeRoot,
    http,
    byteSource: bytes,
    skipSystemJava: true,
    allowProvision: true,
    forceStaleLock: true
  });
  const dt = Date.now() - t0;
  console.log(
    JSON.stringify(
      {
        provisioned: first.provisioned,
        reusedManaged: first.reusedManaged,
        source: first.java.source,
        major: first.java.majorVersion,
        version: first.java.versionString,
        javaPath: first.java.javaPath,
        ms: dt
      },
      null,
      2
    )
  );

  const paths = new RuntimePaths(runtimeRoot);
  const names = await readdir(paths.javaRuntimesDir());
  const identity = names.find((n) => !n.startsWith("."));
  if (!identity) throw new Error("no managed identity after provision");
  const meta = await readManagedJavaMeta(path.join(paths.javaRuntimesDir(), identity));
  if (!meta) throw new Error("missing managed meta");
  console.log(
    JSON.stringify(
      {
        identity: meta.identity,
        provider: meta.provider,
        version: meta.version,
        archiveSha256: meta.archiveSha256,
        archiveSizeBytes: meta.archiveSizeBytes,
        runtimeDir: path.join(paths.javaRuntimesDir(), identity)
      },
      null,
      2
    )
  );

  console.log("=== SECOND ensure (must reuse, no redownload) ===");
  const t1 = Date.now();
  const second = await ensureCompatibleJava({
    requirement: { majorVersion: 25 },
    runtimeRoot,
    http,
    byteSource: bytes,
    skipSystemJava: true,
    allowProvision: true,
    forceStaleLock: true
  });
  console.log(
    JSON.stringify(
      {
        provisioned: second.provisioned,
        reusedManaged: second.reusedManaged,
        source: second.java.source,
        javaPath: second.java.javaPath,
        samePath: second.java.javaPath === first.java.javaPath,
        ms: Date.now() - t1
      },
      null,
      2
    )
  );

  if (second.provisioned) throw new Error("second run re-provisioned unexpectedly");
  if (second.java.source !== "managed") throw new Error("second run not managed");
  if (!second.java.javaPath.includes(path.join("java", "runtimes"))) {
    throw new Error("managed java not under java/runtimes");
  }

  const st = await stat(second.java.javaPath);
  if (!st.isFile()) throw new Error("java.exe missing");
  console.log("PACK06_MANAGED_JAVA_E2E_OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
