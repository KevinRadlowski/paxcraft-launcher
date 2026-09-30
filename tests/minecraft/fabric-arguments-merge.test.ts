/**
 * Fabric/vanilla arguments merge — live bug: wholesale replace dropped -cp ${classpath}.
 * Live Fabric 26.1.2 / 0.19.3: arguments.jvm=["-DFabricMcEmu=..."], arguments.game=[].
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { windowsX64Platform } from "../../src/platform/index.js";
import { RuntimePaths } from "../../src/minecraft/runtime/paths.js";
import { resolveVersionInheritance } from "../../src/minecraft/version/index.js";
import {
  mergeFabricLaunchArguments,
  mergeMinecraftAndFabric,
  parseFabricProfile,
  type ResolvedMinecraftRuntime
} from "../../src/minecraft/fabric/index.js";
import {
  buildLaunchSpec,
  createTestLaunchIdentity,
  buildClasspath
} from "../../src/launch/index.js";
import { buildMinimalFixtures } from "../../fixtures/minecraft/fixtures.js";
import type { DiscoveredJava } from "../../src/java/requirements/index.js";

const VANILLA_JVM_ESSENTIALS = [
  "-Djava.library.path=${natives_directory}",
  "-cp",
  "${classpath}"
] as const;

const LIVE_FABRIC_JVM = "-DFabricMcEmu= net.minecraft.client.main.Main ";

function countOccurrences(arr: unknown[], value: string): number {
  return arr.filter((x) => x === value).length;
}

async function vanillaResolved() {
  const fx = buildMinimalFixtures();
  const vanilla = await resolveVersionInheritance(fx.versionMeta, async () => fx.versionMeta);
  return { fx, vanilla };
}

function liveLikeFabricProfile(fx: ReturnType<typeof buildMinimalFixtures>) {
  return parseFabricProfile({
    ...fx.fabricProfile,
    arguments: {
      game: [],
      jvm: [LIVE_FABRIC_JVM]
    }
  });
}

async function materializeRuntimeFiles(
  paths: RuntimePaths,
  runtime: ResolvedMinecraftRuntime,
  fx: ReturnType<typeof buildMinimalFixtures>
): Promise<void> {
  await mkdir(path.dirname(paths.versionJar(runtime.minecraftVersion)), { recursive: true });
  await writeFile(paths.versionJar(runtime.minecraftVersion), fx.client);
  for (const lib of runtime.libraries) {
    const abs = paths.libraryFile(lib.path);
    await mkdir(path.dirname(abs), { recursive: true });
    const bytes =
      lib.path.includes("fabric-loader")
        ? fx.fabricLib
        : lib.kind === "native"
          ? fx.lwjglNative
          : fx.lwjgl;
    await writeFile(abs, bytes);
  }
}

function fakeJava(root: string): DiscoveredJava {
  return {
    javaPath: path.join(root, "java.exe"),
    majorVersion: 21,
    versionString: "21.0.0",
    source: "known_path"
  };
}

describe("Fabric/vanilla arguments merge", () => {
  it("mergeFabricLaunchArguments: vanilla jvm + fabric jvm preserves -cp", () => {
    const vanilla = {
      jvm: [...VANILLA_JVM_ESSENTIALS],
      game: ["--username", "${auth_player_name}"]
    };
    const fabric = {
      jvm: [LIVE_FABRIC_JVM],
      game: [] as unknown[]
    };
    const merged = mergeFabricLaunchArguments(vanilla, fabric)!;
    assert.ok(merged.jvm!.includes("-cp"));
    assert.ok(merged.jvm!.includes("${classpath}"));
    assert.ok(merged.jvm!.includes("-Djava.library.path=${natives_directory}"));
    assert.ok(merged.jvm!.includes(LIVE_FABRIC_JVM));
    assert.equal(countOccurrences(merged.jvm!, "-cp"), 1);
    // Order: vanilla then fabric
    const cpIdx = merged.jvm!.indexOf("-cp");
    const fabricIdx = merged.jvm!.indexOf(LIVE_FABRIC_JVM);
    assert.ok(cpIdx < fabricIdx);
    assert.deepEqual(merged.game, ["--username", "${auth_player_name}"]);
  });

  it("profil Fabric arguments.game uniquement: JVM vanilla conservés", () => {
    const vanilla = {
      jvm: [...VANILLA_JVM_ESSENTIALS],
      game: ["--username", "p"]
    };
    const fabric = { game: ["--fabricGame"] as unknown[] };
    const merged = mergeFabricLaunchArguments(vanilla, fabric)!;
    assert.deepEqual(merged.jvm, [...VANILLA_JVM_ESSENTIALS]);
    assert.deepEqual(merged.game, ["--username", "p", "--fabricGame"]);
  });

  it("profil Fabric arguments.jvm uniquement: game vanilla conservés", () => {
    const vanilla = {
      jvm: [...VANILLA_JVM_ESSENTIALS],
      game: ["--username", "p"]
    };
    const fabric = { jvm: [LIVE_FABRIC_JVM] };
    const merged = mergeFabricLaunchArguments(vanilla, fabric)!;
    assert.ok(merged.jvm!.includes("-cp"));
    assert.ok(merged.jvm!.includes(LIVE_FABRIC_JVM));
    assert.deepEqual(merged.game, ["--username", "p"]);
  });

  it("vanilla uniquement / Fabric sans arguments: inchangé", () => {
    const vanilla = {
      jvm: [...VANILLA_JVM_ESSENTIALS],
      game: ["--username", "p"]
    };
    assert.deepEqual(mergeFabricLaunchArguments(vanilla, undefined), vanilla);
    assert.equal(mergeFabricLaunchArguments(undefined, undefined), undefined);
  });

  it("ordre déterministe et pas de duplication -cp", () => {
    const a = mergeFabricLaunchArguments(
      { jvm: ["-Da", "-cp", "${classpath}"], game: ["g1"] },
      { jvm: ["-Df"], game: ["g2"] }
    )!;
    assert.deepEqual(a.jvm, ["-Da", "-cp", "${classpath}", "-Df"]);
    assert.deepEqual(a.game, ["g1", "g2"]);
    assert.equal(countOccurrences(a.jvm!, "-cp"), 1);
  });

  it("mergeMinecraftAndFabric: live-like Fabric arguments conserve -cp", async () => {
    const { fx, vanilla } = await vanillaResolved();
    assert.ok(vanilla.arguments?.jvm?.includes("-cp"));
    assert.ok(vanilla.arguments?.jvm?.includes("${classpath}"));

    const fabric = liveLikeFabricProfile(fx);
    assert.ok(fabric.raw.arguments);
    assert.ok(Array.isArray(fabric.raw.arguments?.jvm));
    assert.equal(fabric.raw.arguments!.jvm!.length, 1);
    assert.deepEqual(fabric.raw.arguments!.game, []);

    const runtime = mergeMinecraftAndFabric({
      vanilla,
      fabric,
      platform: windowsX64Platform()
    });

    assert.ok(runtime.arguments?.jvm?.includes("-cp"));
    assert.ok(runtime.arguments?.jvm?.includes("${classpath}"));
    assert.ok(runtime.arguments?.jvm?.includes(LIVE_FABRIC_JVM));
    assert.equal(countOccurrences(runtime.arguments!.jvm!, "-cp"), 1);
    assert.ok(runtime.arguments?.game?.includes("--username"));
  });

  it("bug live: LaunchSpec a -cp et classpath contient fabric-loader", async () => {
    const { fx, vanilla } = await vanillaResolved();
    const fabric = liveLikeFabricProfile(fx);
    const runtime = mergeMinecraftAndFabric({
      vanilla,
      fabric,
      platform: windowsX64Platform()
    });

    assert.ok(
      runtime.libraries.some((l) => l.path.includes("fabric-loader")),
      "classpathEntries source: fabric-loader library present"
    );

    const root = await mkdtemp(path.join(tmpdir(), "sc-fab-args-"));
    const paths = new RuntimePaths(root);
    await materializeRuntimeFiles(paths, runtime, fx);
    await writeFile(path.join(root, "java.exe"), "fake");
    const instanceRoot = await mkdtemp(path.join(tmpdir(), "sc-fab-inst-"));

    const cp = await buildClasspath({
      runtime,
      paths,
      platform: windowsX64Platform(),
      requireFilesExist: true
    });
    assert.ok(
      cp.entries.some((e) => e.includes("fabric-loader")),
      "classpathEntries must include fabric-loader"
    );

    const spec = await buildLaunchSpec({
      runtime,
      paths,
      instanceRoot,
      platform: windowsX64Platform(),
      java: fakeJava(root),
      identity: createTestLaunchIdentity(),
      memory: { maxMemoryMiB: 2048 }
    });

    const cpFlagIdx = spec.jvmArgs.indexOf("-cp");
    assert.ok(cpFlagIdx >= 0, "LaunchSpec.jvmArgs must contain -cp");
    const cpValue = spec.jvmArgs[cpFlagIdx + 1];
    assert.ok(typeof cpValue === "string" && cpValue.length > 0, "value after -cp required");
    assert.ok(
      cpValue!.includes("fabric-loader"),
      `classpath after -cp must contain fabric-loader, got: ${cpValue!.slice(0, 200)}...`
    );
    assert.ok(spec.classpathEntries.some((e) => e.includes("fabric-loader")));
    assert.equal(spec.jvmArgs.filter((a) => a === "-cp").length, 1);
  });

  it("Fabric sans bloc arguments: comportement inchangé (vanilla args)", async () => {
    const { fx, vanilla } = await vanillaResolved();
    const fabric = parseFabricProfile(fx.fabricProfile);
    assert.equal(fabric.raw.arguments, undefined);
    const runtime = mergeMinecraftAndFabric({
      vanilla,
      fabric,
      platform: windowsX64Platform()
    });
    assert.deepEqual(runtime.arguments?.jvm, vanilla.arguments?.jvm);
    assert.deepEqual(runtime.arguments?.game, vanilla.arguments?.game);
  });
});
