/**
 * Fabric Maven-style libraries (name + url, no downloads.artifact).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ErrorCode, LauncherError } from "../../src/core/errors/index.js";
import { windowsX64Platform } from "../../src/platform/index.js";
import { parseVersionMeta } from "../../src/minecraft/metadata/types.js";
import {
  resolveLibrariesForPlatform,
  mavenNameToPath,
  joinMavenArtifactUrl
} from "../../src/minecraft/libraries/index.js";
import {
  parseMavenChecksumSidecar,
  mavenDigestSidecarUrl,
  parseMavenCoordinate
} from "../../src/minecraft/libraries/maven.js";
import { ensureMavenSidecarIntegrity } from "../../src/minecraft/libraries/sidecar.js";
import {
  parseFabricProfile,
  mergeMinecraftAndFabric
} from "../../src/minecraft/fabric/index.js";
import { buildClasspath } from "../../src/launch/classpath.js";
import { RuntimePaths } from "../../src/minecraft/runtime/paths.js";
import { fetchedFromBuffer } from "../../src/minecraft/metadata/bytes.js";
import { sha1, sha256 } from "../../fixtures/minecraft/fixtures.js";
import { buildMinimalFixtures } from "../../fixtures/minecraft/fixtures.js";
import { resolveVersionInheritance } from "../../src/minecraft/version/index.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

describe("Fabric Maven libraries (0.3A)", () => {
  it("1. Fabric profile library without downloads.artifact is retained", () => {
    const profile = parseFabricProfile({
      id: "fabric-loader-0.19.3-26.1.2",
      mainClass: "net.fabricmc.loader.impl.launch.knot.KnotClient",
      libraries: [
        {
          name: "net.fabricmc:fabric-loader:0.19.3",
          url: "https://maven.fabricmc.net/"
        }
      ]
    });
    const resolved = resolveLibrariesForPlatform(profile.libraries, windowsX64Platform);
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0]!.name, "net.fabricmc:fabric-loader:0.19.3");
    assert.equal(resolved[0]!.needsMavenSidecar, true);
    assert.match(resolved[0]!.download.url, /fabric-loader-0\.19\.3\.jar$/);
  });

  it("2. maven coordinates map to expected path", () => {
    assert.equal(
      mavenNameToPath("net.fabricmc:fabric-loader:0.19.3"),
      "net/fabricmc/fabric-loader/0.19.3/fabric-loader-0.19.3.jar"
    );
    assert.equal(
      mavenNameToPath("net.fabricmc:sponge-mixin:0.17.3+mixin.0.8.7"),
      "net/fabricmc/sponge-mixin/0.17.3+mixin.0.8.7/sponge-mixin-0.17.3+mixin.0.8.7.jar"
    );
  });

  it("3. HTTPS Fabric repository builds exact artifact URL", () => {
    const p = mavenNameToPath("net.fabricmc:fabric-loader:0.19.3");
    assert.equal(
      joinMavenArtifactUrl("https://maven.fabricmc.net/", p),
      "https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.19.3/fabric-loader-0.19.3.jar"
    );
  });

  it("4. inline sha256 sidecar-equivalent accepts library", () => {
    const digest = sha256("loader-bytes");
    const profile = parseFabricProfile({
      id: "fabric-loader-0.19.3-26.1.2",
      mainClass: "net.fabricmc.loader.impl.launch.knot.KnotClient",
      libraries: [
        {
          name: "net.fabricmc:fabric-loader:0.19.3",
          url: "https://maven.fabricmc.net/",
          sha256: digest,
          size: 12
        }
      ]
    });
    const resolved = resolveLibrariesForPlatform(profile.libraries, windowsX64Platform);
    assert.equal(resolved[0]!.needsMavenSidecar, undefined);
    assert.equal(resolved[0]!.integrity.algorithm, "sha256");
    assert.equal(resolved[0]!.integrity.digest, digest);
  });

  it("5–7. sidecar mismatch / absent / malformed fail closed", async () => {
    const base = resolveLibrariesForPlatform(
      [
        {
          name: "net.fabricmc:fabric-loader:0.19.3",
          mavenUrl: "https://maven.fabricmc.net/"
        }
      ],
      windowsX64Platform
    );
    assert.equal(base[0]!.needsMavenSidecar, true);

    await assert.rejects(
      () =>
        ensureMavenSidecarIntegrity(base, async () =>
          fetchedFromBuffer("deadbeef_not_a_valid_digest")
        ),
      (e: unknown) =>
        e instanceof LauncherError && e.code === ErrorCode.DOWNLOAD_HASH_MISMATCH
    );

    await assert.rejects(
      () =>
        ensureMavenSidecarIntegrity(base, async () => {
          throw new LauncherError(ErrorCode.HTTP_ERROR, "404", { status: 404 });
        }),
      (e: unknown) =>
        e instanceof LauncherError && e.code === ErrorCode.DOWNLOAD_HASH_MISMATCH
    );

    assert.throws(
      () => parseMavenChecksumSidecar("xyz", "sha256"),
      (e: unknown) =>
        e instanceof LauncherError && e.code === ErrorCode.DOWNLOAD_HASH_MISMATCH
    );
  });

  it("4b. valid sha256 sidecar enriches library", async () => {
    const bytes = Buffer.from("fabric-loader-jar");
    const digest = sha256(bytes);
    const base = resolveLibrariesForPlatform(
      [
        {
          name: "net.fabricmc:fabric-loader:0.19.3",
          mavenUrl: "https://maven.fabricmc.net/"
        }
      ],
      windowsX64Platform
    );
    const enriched = await ensureMavenSidecarIntegrity(base, async (url) => {
      assert.ok(url.endsWith(".sha256"));
      return fetchedFromBuffer(`${digest}  fabric-loader-0.19.3.jar\n`);
    });
    assert.equal(enriched[0]!.needsMavenSidecar, undefined);
    assert.equal(enriched[0]!.integrity.algorithm, "sha256");
    assert.equal(enriched[0]!.integrity.digest, digest);
  });

  it("8. HTTP repository refused", () => {
    assert.throws(
      () =>
        resolveLibrariesForPlatform(
          [
            {
              name: "net.fabricmc:fabric-loader:0.19.3",
              mavenUrl: "http://maven.fabricmc.net/"
            }
          ],
          windowsX64Platform
        ),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.UNSAFE_REDIRECT
    );
    // Also at parse time:
    assert.throws(
      () =>
        parseVersionMeta({
          id: "fabric-loader-0.19.3-26.1.2",
          mainClass: "net.fabricmc.loader.impl.launch.knot.KnotClient",
          libraries: [{ name: "net.fabricmc:fabric-loader:0.19.3", url: "http://evil.test/" }]
        }),
      (e: unknown) => e instanceof LauncherError && e.code === ErrorCode.UNSAFE_REDIRECT
    );
  });

  it("9. traversal / invalid maven coordinate refused", () => {
    assert.throws(
      () => parseMavenCoordinate("evil:../x:1.0"),
      (e: unknown) => e instanceof LauncherError
    );
    assert.throws(
      () => mavenNameToPath("net.fabricmc:fabric-loader:../0.19.3"),
      (e: unknown) => e instanceof LauncherError
    );
  });

  it("10–12. Fabric loader + multiple maven libs in merge/plan classpath", async () => {
    const fx = buildMinimalFixtures();
    const vanilla = await resolveVersionInheritance(fx.versionMeta, async () => {
      throw new Error("no parent");
    });

    const asmSha = sha256("asm");
    const fabric = parseFabricProfile({
      id: `fabric-loader-0.19.3-${fx.versionMeta.id}`,
      mainClass: "net.fabricmc.loader.impl.launch.knot.KnotClient",
      libraries: [
        {
          name: "org.ow2.asm:asm:9.10.1",
          url: "https://maven.fabricmc.net/",
          sha256: asmSha,
          size: 3
        },
        {
          name: "net.fabricmc:fabric-loader:0.19.3",
          url: "https://maven.fabricmc.net/",
          sha256: sha256(fx.fabricLib),
          size: fx.fabricLib.byteLength
        }
      ]
    });

    const merged = mergeMinecraftAndFabric({
      vanilla,
      fabric,
      platform: windowsX64Platform
    });
    const names = merged.libraries.map((l) => l.name);
    assert.ok(names.includes("net.fabricmc:fabric-loader:0.19.3"));
    assert.ok(names.includes("org.ow2.asm:asm:9.10.1"));

    const root = await mkdtemp(path.join(tmpdir(), "sc-fabric-cp-"));
    const paths = new RuntimePaths(root);
    const cp = await buildClasspath({
      runtime: merged,
      paths,
      platform: windowsX64Platform,
      requireFilesExist: false
    });
    assert.ok(
      cp.entries.some((p) => p.replace(/\\/g, "/").includes("fabric-loader-0.19.3.jar")),
      "classpath must include fabric-loader jar path"
    );
  });

  it("13. Mojang downloads.artifact libraries unchanged", () => {
    const fx = buildMinimalFixtures();
    const libs = resolveLibrariesForPlatform(fx.versionMeta.libraries ?? [], windowsX64Platform);
    assert.ok(libs.length >= 1);
    assert.ok(libs.every((l) => l.download.url.startsWith("https://")));
    assert.ok(libs.every((l) => !l.needsMavenSidecar));
  });

  it("16. Maven library is never silently dropped when url present", () => {
    const raw = parseVersionMeta({
      id: "fabric-loader-0.19.3-26.1.2",
      mainClass: "net.fabricmc.loader.impl.launch.knot.KnotClient",
      libraries: [
        { name: "net.fabricmc:fabric-loader:0.19.3", url: "https://maven.fabricmc.net/" },
        {
          name: "org.ow2.asm:asm:9.10.1",
          url: "https://maven.fabricmc.net/",
          sha1: sha1("asm"),
          size: 3
        }
      ]
    });
    const resolved = resolveLibrariesForPlatform(raw.libraries ?? [], windowsX64Platform);
    assert.equal(resolved.length, 2);
  });

  it("sidecar URL helpers", () => {
    const art =
      "https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.19.3/fabric-loader-0.19.3.jar";
    assert.equal(mavenDigestSidecarUrl(art, "sha256"), `${art}.sha256`);
    assert.equal(mavenDigestSidecarUrl(art, "sha1"), `${art}.sha1`);
    assert.equal(parseMavenChecksumSidecar("abc".padEnd(64, "0"), "sha256").length, 64);
  });
});
