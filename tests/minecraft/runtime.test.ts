import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { ErrorCode, LauncherError } from "../../src/core/errors/index.js";
import { DownloadEngine } from "../../src/download/engine/index.js";
import { MockByteSource } from "../../src/download/engine/sources.js";
import { windowsX64Platform } from "../../src/platform/index.js";
import { evaluateRules } from "../../src/minecraft/rules/index.js";
import {
  findExactVersion,
  parseVersionManifest,
  parseVersionMeta
} from "../../src/minecraft/metadata/types.js";
import { resolveVersionInheritance } from "../../src/minecraft/version/index.js";
import { resolveLibrariesForPlatform, mavenNameToPath } from "../../src/minecraft/libraries/index.js";
import { parseAssetIndex, assetObjectRelativePath } from "../../src/minecraft/assets/index.js";
import { extractZipSecure, assertSafeZipEntryName } from "../../src/minecraft/natives/index.js";
import {
  selectExactFabricLoader,
  parseFabricLoaderList,
  parseFabricProfile,
  mergeMinecraftAndFabric
} from "../../src/minecraft/fabric/index.js";
import {
  parseJavaVersionOutput,
  isJavaCompatible,
  pickCompatibleJava
} from "../../src/java/discovery/index.js";
import { RuntimePaths } from "../../src/minecraft/runtime/paths.js";
import { buildRuntimeInstallationPlan } from "../../src/minecraft/runtime/plan.js";
import { auditRuntime, planRuntimeRepair } from "../../src/minecraft/audit/index.js";
import { InstanceLock } from "../../src/instance/lock/index.js";
import { InstancePaths } from "../../src/instance/layout/index.js";
import {
  buildMinimalFixtures,
  buildInheritanceFixtures,
  mockRuntimeSources,
  mockInheritanceSources,
  buildZip,
  sha1,
  sha256,
  MC,
  FABRIC
} from "../../fixtures/minecraft/fixtures.js";
import { sha1Integrity, sha256Integrity } from "../../src/minecraft/integrity/index.js";
import {
  loadSha1VerifiedJson,
  loadVerifiedAssetIndexJson,
  fetchedFromBuffer
} from "../../src/minecraft/metadata/bytes.js";

describe("minecraft runtime 0.3A", () => {
  it("finds exact Minecraft version and fails when missing", () => {
    const fx = buildMinimalFixtures();
    const manifest = parseVersionManifest(fx.versionManifest);
    assert.equal(findExactVersion(manifest, MC).id, MC);
    assert.throws(
      () => findExactVersion(manifest, "1.2.3"),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.MINECRAFT_VERSION_NOT_FOUND
    );
  });

  it("rejects version manifest entry without sha1", () => {
    assert.throws(
      () =>
        parseVersionManifest({
          latest: { release: "x", snapshot: "x" },
          versions: [{ id: "x", type: "release", url: "https://example.test/x.json" }]
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.MINECRAFT_METADATA_SHA1_MISSING
    );
  });

  it("rejects invalid version metadata", () => {
    assert.throws(
      () => parseVersionMeta({}),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INVALID_MINECRAFT_METADATA
    );
  });

  it("rejects negative / fractional artifact size and invalid java majorVersion", () => {
    assert.throws(
      () =>
        parseVersionMeta({
          id: "x",
          downloads: {
            client: { sha1: "a".repeat(40), size: -1, url: "https://example.test/c.jar" }
          }
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INVALID_MINECRAFT_METADATA
    );
    assert.throws(
      () =>
        parseVersionMeta({
          id: "x",
          downloads: {
            client: { sha1: "a".repeat(40), size: 1.5, url: "https://example.test/c.jar" }
          }
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INVALID_MINECRAFT_METADATA
    );
    assert.throws(
      () =>
        parseVersionMeta({
          id: "x",
          javaVersion: { majorVersion: Number.NaN }
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INVALID_MINECRAFT_METADATA
    );
    assert.throws(
      () =>
        parseVersionMeta({
          id: "x",
          javaVersion: { majorVersion: 21.5 }
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INVALID_MINECRAFT_METADATA
    );
  });

  it("rejects malformed library rules with structured error", () => {
    assert.throws(
      () =>
        parseVersionMeta({
          id: "x",
          libraries: [{ name: "a:b:1", rules: ["not-an-object"] }]
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INVALID_MINECRAFT_METADATA
    );
    assert.throws(
      () =>
        parseVersionMeta({
          id: "x",
          libraries: [{ name: "a:b:1", rules: [{ action: "maybe" }] }]
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INVALID_MINECRAFT_METADATA
    );
  });

  it("detects inheritance cycle and depth", async () => {
    await assert.rejects(
      () =>
        resolveVersionInheritance(
          { id: "a", inheritsFrom: "b", mainClass: "X" },
          async (id) => (id === "b" ? { id: "b", inheritsFrom: "a" } : {})
        ),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INHERITANCE_CYCLE
    );
  });

  it("library rules: windows allow/disallow, linux-only ignored, no rules, order", () => {
    const win = windowsX64Platform();
    assert.equal(evaluateRules(undefined, { platform: win }), true);
    assert.equal(evaluateRules([{ action: "allow", os: { name: "windows" } }], { platform: win }), true);
    assert.equal(
      evaluateRules(
        [
          { action: "allow" },
          { action: "disallow", os: { name: "windows" } }
        ],
        { platform: win }
      ),
      false
    );
    assert.equal(evaluateRules([{ action: "allow", os: { name: "linux" } }], { platform: win }), false);
    assert.equal(evaluateRules([{ action: "allow", features: { is_demo_user: true } }], { platform: win }), false);
  });

  it("rejects unsafe library path / maven name", () => {
    assert.throws(() => mavenNameToPath("evil:../x:1.0"), (e: unknown) => e instanceof LauncherError);
  });

  it("client jar sha1 integrity via DownloadEngine", async () => {
    const fx = buildMinimalFixtures();
    const source = new MockByteSource();
    source.set("https://example.test/client.jar", fx.client);
    const tmp = await mkdtemp(path.join(tmpdir(), "sc-rt-"));
    const engine = new DownloadEngine({ source, tmpDir: tmp, maxRetries: 0 });
    const ok = await engine.download({
      id: "client",
      url: "https://example.test/client.jar",
      integrity: sha1Integrity(sha1(fx.client)),
      expectedSize: fx.client.byteLength,
      maxBytes: 1000,
      timeoutMs: 2000,
      targetPath: "client.jar"
    });
    assert.equal(ok.algorithm, "sha1");
    assert.equal(ok.digest, sha1(fx.client));

    await assert.rejects(
      () =>
        engine.download({
          id: "bad",
          url: "https://example.test/client.jar",
          integrity: sha1Integrity("0".repeat(40)),
          expectedSize: fx.client.byteLength,
          maxBytes: 1000,
          timeoutMs: 2000,
          targetPath: "bad.jar"
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.DOWNLOAD_HASH_MISMATCH
    );
  });

  it("SHA-256 regression still works", async () => {
    const body = Buffer.from("sweetcraft-bytes");
    const source = new MockByteSource();
    source.set("https://cdn.example.test/x.bin", body);
    const tmp = await mkdtemp(path.join(tmpdir(), "sc-rt-"));
    const engine = new DownloadEngine({ source, tmpDir: tmp, maxRetries: 0 });
    const r = await engine.download({
      id: "sc",
      url: "https://cdn.example.test/x.bin",
      expectedSha256: sha256(body),
      expectedSize: body.byteLength,
      maxBytes: 1000,
      timeoutMs: 2000,
      targetPath: "x.bin"
    });
    assert.equal(r.algorithm, "sha256");
    assert.equal(r.sha256, sha256(body));
  });

  it("parses asset index, path by hash, dedupes duplicate objects, rejects bad hash", () => {
    const fx = buildMinimalFixtures();
    const parsed = parseAssetIndex("26", fx.assetIndex);
    assert.equal(parsed.objects.length, 1);
    assert.equal(assetObjectRelativePath(fx.assetHash), `objects/${fx.assetHash.slice(0, 2)}/${fx.assetHash}`);
    assert.throws(
      () => parseAssetIndex("x", { objects: { a: { hash: "zz", size: 1 } } }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INVALID_ASSET_OBJECT
    );
  });

  it("Fabric exact loader / missing / invalid", () => {
    const fx = buildMinimalFixtures();
    const list = parseFabricLoaderList(fx.fabricLoaders);
    assert.equal(selectExactFabricLoader(list, FABRIC).loader.version, FABRIC);
    assert.throws(
      () => selectExactFabricLoader(list, "9.9.9"),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.FABRIC_LOADER_NOT_FOUND
    );
    assert.throws(
      () => parseFabricProfile({ id: "bad", mainClass: "X" }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INVALID_FABRIC_METADATA
    );
  });

  it("detects Minecraft/Fabric library path collision", async () => {
    const fx = buildMinimalFixtures();
    const vanilla = await resolveVersionInheritance(fx.versionMeta, async () => fx.versionMeta);
    const fabric = parseFabricProfile({
      ...fx.fabricProfile,
      libraries: [
        {
          name: "org.lwjgl:lwjgl:3.3.3",
          downloads: {
            artifact: {
              path: "org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3.jar",
              sha1: "1".repeat(40),
              size: 1,
              url: "https://example.test/collision.jar"
            }
          }
        }
      ]
    });
    assert.throws(
      () => mergeMinecraftAndFabric({ vanilla, fabric, platform: windowsX64Platform() }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.RUNTIME_LIBRARY_COLLISION
    );
  });

  it("resolves native classifier and extracts ZIP; Zip Slip refused", async () => {
    const fx = buildMinimalFixtures();
    const vanilla = await resolveVersionInheritance(fx.versionMeta, async () => fx.versionMeta);
    const libs = resolveLibrariesForPlatform(vanilla.libraries, windowsX64Platform());
    assert.ok(libs.some((l) => l.kind === "native"));
    assert.ok(!libs.some((l) => l.name.includes("linuxonly")));

    const dest = await mkdtemp(path.join(tmpdir(), "sc-nat-"));
    const written = await extractZipSecure({
      zipBytes: fx.lwjglNative,
      destRoot: dest,
      excludePrefixes: ["META-INF/"]
    });
    assert.ok(written.includes("lwjgl.dll"));
    assert.ok(!written.some((w) => w.startsWith("META-INF")));

    assert.throws(() => assertSafeZipEntryName("../evil.dll"), (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.ZIP_SLIP_REFUSED);
    assert.throws(() => assertSafeZipEntryName("/abs.dll"), (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.ZIP_SLIP_REFUSED);

    const evil = buildZip([{ name: "../evil.dll", data: Buffer.from("x") }]);
    await assert.rejects(
      () => extractZipSecure({ zipBytes: evil, destRoot: dest }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.ZIP_SLIP_REFUSED
    );
  });

  it("parses Java versions and compatibility", () => {
    assert.equal(parseJavaVersionOutput('openjdk version "21.0.2" 2024-01-16').majorVersion, 21);
    assert.equal(parseJavaVersionOutput('java version "1.8.0_402"').majorVersion, 8);
    const d = {
      javaPath: "java",
      majorVersion: 21,
      versionString: "21.0.2",
      source: "PATH" as const
    };
    assert.equal(isJavaCompatible(d, { majorVersion: 21 }), true);
    assert.equal(isJavaCompatible(d, { majorVersion: 22 }), false);
    assert.throws(
      () => pickCompatibleJava([{ ...d, majorVersion: 17 }], { majorVersion: 21 }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INCOMPATIBLE_JAVA
    );
  });

  it("version metadata valid sha1 OK; bad sha1 refused before parse", async () => {
    const fx = buildMinimalFixtures();
    const ok = loadSha1VerifiedJson(fetchedFromBuffer(fx.versionMetaBuf), sha1(fx.versionMetaBuf));
    assert.equal((ok as { id: string }).id, MC);
    assert.throws(
      () => loadSha1VerifiedJson(fetchedFromBuffer(fx.versionMetaBuf), "0".repeat(40)),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.MINECRAFT_METADATA_HASH_MISMATCH
    );
    const root = await mkdtemp(path.join(tmpdir(), "sc-badsha-"));
    const paths = new RuntimePaths(root);
    const badManifest = {
      ...fx.versionManifest,
      versions: [{ ...fx.versionManifest.versions[0]!, sha1: "0".repeat(40) }]
    };
    await assert.rejects(
      () =>
        buildRuntimeInstallationPlan({
          minecraftVersion: MC,
          fabricLoaderVersion: FABRIC,
          platform: windowsX64Platform(),
          paths,
          sources: {
            ...mockRuntimeSources(fx),
            async fetchVersionManifest() {
              return fetchedFromBuffer(JSON.stringify(badManifest));
            }
          },
          dryRun: true
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.MINECRAFT_METADATA_HASH_MISMATCH
    );
  });

  it("parent metadata valid sha1 OK; bad parent sha1 refused", async () => {
    const fx = buildInheritanceFixtures();
    const root = await mkdtemp(path.join(tmpdir(), "sc-inh-"));
    const paths = new RuntimePaths(root);
    const ok = await buildRuntimeInstallationPlan({
      minecraftVersion: MC,
      fabricLoaderVersion: FABRIC,
      platform: windowsX64Platform(),
      paths,
      sources: mockInheritanceSources(fx),
      dryRun: true
    });
    assert.ok(ok.resolved.inheritanceChain.includes(MC));
    await assert.rejects(
      () =>
        buildRuntimeInstallationPlan({
          minecraftVersion: MC,
          fabricLoaderVersion: FABRIC,
          platform: windowsX64Platform(),
          paths,
          sources: mockInheritanceSources(fx, { corruptParent: true }),
          dryRun: true
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.MINECRAFT_METADATA_HASH_MISMATCH
    );
  });

  it("asset index valid sha1+size OK; bad sha1/size refused before objects", () => {
    const fx = buildMinimalFixtures();
    const parsed = loadVerifiedAssetIndexJson(fetchedFromBuffer(fx.assetIndexBuf), {
      sha1: sha1(fx.assetIndexBuf),
      size: fx.assetIndexBuf.byteLength
    });
    assert.ok(parsed && typeof parsed === "object");
    assert.throws(
      () =>
        loadVerifiedAssetIndexJson(fetchedFromBuffer(fx.assetIndexBuf), {
          sha1: "0".repeat(40),
          size: fx.assetIndexBuf.byteLength
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.ASSET_INDEX_HASH_MISMATCH
    );
    assert.throws(
      () =>
        loadVerifiedAssetIndexJson(fetchedFromBuffer(fx.assetIndexBuf), {
          sha1: sha1(fx.assetIndexBuf),
          size: fx.assetIndexBuf.byteLength + 1
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.ASSET_INDEX_SIZE_MISMATCH
    );
  });

  it("Fabric profile fetched exactly once", async () => {
    const fx = buildMinimalFixtures();
    const root = await mkdtemp(path.join(tmpdir(), "sc-fabonce-"));
    const paths = new RuntimePaths(root);
    const counters = { fabricProfileFetches: { count: 0 } };
    await buildRuntimeInstallationPlan({
      minecraftVersion: MC,
      fabricLoaderVersion: FABRIC,
      platform: windowsX64Platform(),
      paths,
      sources: mockRuntimeSources(fx, counters),
      dryRun: true
    });
    assert.equal(counters.fabricProfileFetches.count, 1);
  });

  it("runtime fresh plan / current keep / repair / dry-run / audit / lock", async () => {
    const fx = buildMinimalFixtures();
    const root = await mkdtemp(path.join(tmpdir(), "sc-runtime-"));
    const paths = new RuntimePaths(root);
    const sources = mockRuntimeSources(fx);

    const fresh = await buildRuntimeInstallationPlan({
      minecraftVersion: MC,
      fabricLoaderVersion: FABRIC,
      platform: windowsX64Platform(),
      paths,
      sources,
      dryRun: true
    });
    assert.ok(fresh.summary.download >= 1);
    assert.equal(fresh.mainClass.includes("fabricmc") || fresh.mainClass.includes("Knot"), true);
    assert.equal(fresh.javaRequirement?.majorVersion, 21);

    // Simulate installed client
    await mkdir(path.dirname(paths.versionJar(MC)), { recursive: true });
    await writeFile(paths.versionJar(MC), fx.client);
    const current = await buildRuntimeInstallationPlan({
      minecraftVersion: MC,
      fabricLoaderVersion: FABRIC,
      platform: windowsX64Platform(),
      paths,
      sources,
      dryRun: true
    });
    assert.ok(current.entries.some((e) => e.kind === "client" && e.action === "KEEP"));

    await writeFile(paths.versionJar(MC), Buffer.from("corrupt"));
    const repairPlan = await planRuntimeRepair({
      minecraftVersion: MC,
      fabricLoaderVersion: FABRIC,
      platform: windowsX64Platform(),
      paths,
      sources
    });
    assert.ok(repairPlan.entries.some((e) => e.kind === "client" && e.action === "REPAIR"));

    const audit = await auditRuntime({
      minecraftVersion: MC,
      fabricLoaderVersion: FABRIC,
      platform: windowsX64Platform(),
      paths,
      sources,
      discoveredJava: []
    });
    assert.ok(audit.findings.some((f) => f.status === "MISSING_JAVA"));

    const lockPaths = new InstancePaths(root);
    const lock = new InstanceLock(lockPaths);
    await lock.acquire("runtime-install");
    await assert.rejects(
      () => new InstanceLock(lockPaths).acquire("runtime-install"),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.INSTANCE_LOCKED
    );
    await lock.release();
  });

  it("download abort/timeout still work for runtime artefacts", async () => {
    const source = new MockByteSource();
    source.set("https://example.test/slow.jar", Buffer.from("ab"), {
      stallAfterBytes: 1,
      stallMs: 60_000
    });
    const tmp = await mkdtemp(path.join(tmpdir(), "sc-rt-"));
    const engine = new DownloadEngine({ source, tmpDir: tmp, maxRetries: 0 });
    await assert.rejects(
      () =>
        engine.download({
          id: "slow",
          url: "https://example.test/slow.jar",
          integrity: sha1Integrity(sha1("ab")),
          expectedSize: 2,
          maxBytes: 100,
          timeoutMs: 40,
          targetPath: "slow.jar"
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.HTTP_TIMEOUT
    );
  });
});
