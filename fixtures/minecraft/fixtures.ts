import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { ErrorCode, LauncherError } from "../../src/core/errors/index.js";
import { fetchedFromBuffer, type FetchedMetadata } from "../../src/minecraft/metadata/bytes.js";
import type { RuntimeMetadataSources } from "../../src/minecraft/runtime/plan.js";

export function sha1(data: Buffer | string): string {
  return createHash("sha1").update(data).digest("hex");
}

export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Build a minimal ZIP (STORE and/or DEFLATE) for hermetic native tests. */
export function buildZip(entries: Array<{ name: string; data: Buffer; method?: 0 | 8 }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const method = entry.method ?? 0;
    const compressed = method === 8 ? deflateRawSync(entry.data) : entry.data;
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30 + nameBuf.byteLength);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(compressed.byteLength, 18);
    local.writeUInt32LE(entry.data.byteLength, 22);
    local.writeUInt16LE(nameBuf.byteLength, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);

    const localOffset = offset;
    localParts.push(local, compressed);
    offset += local.byteLength + compressed.byteLength;

    const central = Buffer.alloc(46 + nameBuf.byteLength);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc >>> 0, 16);
    central.writeUInt32LE(compressed.byteLength, 20);
    central.writeUInt32LE(entry.data.byteLength, 24);
    central.writeUInt16LE(nameBuf.byteLength, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(localOffset, 42);
    nameBuf.copy(central, 46);
    centralParts.push(central);
  }

  const centralDir = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, end]);
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.byteLength; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    }
  }
  return ~c;
}

export const MC = "26.1.2";
export const FABRIC = "0.19.3";
export const PARENT_ID = "26.1.2-parent";

export function clientJarBytes(): Buffer {
  return Buffer.from("fake-minecraft-client-jar");
}

export function libBytes(tag: string): Buffer {
  return Buffer.from(`lib-${tag}`);
}

export function buildMinimalFixtures() {
  const client = clientJarBytes();
  const lwjgl = libBytes("lwjgl");
  const lwjglNative = buildZip([
    { name: "lwjgl.dll", data: Buffer.from("dll-bytes") },
    { name: "META-INF/MANIFEST.MF", data: Buffer.from("Manifest-Version: 1.0\n") }
  ]);
  const fabricLib = libBytes("fabric-loader");
  const asset = Buffer.from("asset-png-bytes");

  const assetHash = sha1(asset);
  const assetIndex = {
    objects: {
      "minecraft/lang/en_us.json": { hash: assetHash, size: asset.byteLength },
      "duplicate/same": { hash: assetHash, size: asset.byteLength }
    }
  };
  const assetIndexBuf = Buffer.from(JSON.stringify(assetIndex));

  const versionMeta = {
    id: MC,
    mainClass: "net.minecraft.client.main.Main",
    javaVersion: { component: "java-runtime-delta", majorVersion: 21 },
    assetIndex: {
      id: "26",
      sha1: sha1(assetIndexBuf),
      size: assetIndexBuf.byteLength,
      totalSize: asset.byteLength,
      url: "https://example.test/indexes/26.json"
    },
    downloads: {
      client: {
        sha1: sha1(client),
        size: client.byteLength,
        url: "https://example.test/client.jar"
      }
    },
    libraries: [
      {
        name: "org.lwjgl:lwjgl:3.3.3",
        downloads: {
          artifact: {
            path: "org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3.jar",
            sha1: sha1(lwjgl),
            size: lwjgl.byteLength,
            url: "https://example.test/lwjgl.jar"
          }
        }
      },
      {
        name: "org.lwjgl:lwjgl:3.3.3",
        rules: [{ action: "allow", os: { name: "windows" } }],
        natives: { windows: "natives-windows" },
        extract: { exclude: ["META-INF/"] },
        downloads: {
          classifiers: {
            "natives-windows": {
              path: "org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-windows.jar",
              sha1: sha1(lwjglNative),
              size: lwjglNative.byteLength,
              url: "https://example.test/lwjgl-natives.jar"
            }
          }
        }
      },
      {
        name: "com.example:linuxonly:1.0",
        rules: [{ action: "allow", os: { name: "linux" } }],
        downloads: {
          artifact: {
            path: "com/example/linuxonly/1.0/linuxonly-1.0.jar",
            sha1: sha1("linux"),
            size: 5,
            url: "https://example.test/linux.jar"
          }
        }
      }
    ],
    type: "release",
    arguments: {
      jvm: [
        "-Djava.library.path=${natives_directory}",
        "-Dminecraft.launcher.brand=${launcher_name}",
        "-Dminecraft.launcher.version=${launcher_version}",
        "-cp",
        "${classpath}",
        {
          rules: [{ action: "allow", os: { name: "windows" } }],
          value: "-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump"
        },
        {
          rules: [{ action: "allow", os: { name: "linux" } }],
          value: "-Dlinux.only=1"
        },
        {
          rules: [{ action: "disallow", os: { name: "windows" } }],
          value: "-Dshould.not.appear=1"
        }
      ],
      game: [
        "--username",
        "${auth_player_name}",
        "--version",
        "${version_name}",
        "--gameDir",
        "${game_directory}",
        "--assetsDir",
        "${assets_root}",
        "--assetIndex",
        "${assets_index_name}",
        "--uuid",
        "${auth_uuid}",
        "--accessToken",
        "${auth_access_token}",
        "--userType",
        "${user_type}",
        "--versionType",
        "${version_type}",
        {
          rules: [{ action: "allow", features: { has_custom_resolution: true } }],
          value: ["--width", "${resolution_width}", "--height", "${resolution_height}"]
        },
        {
          rules: [{ action: "allow", features: { is_demo_user: true } }],
          value: "--demo"
        }
      ]
    }
  };

  const versionMetaBuf = Buffer.from(JSON.stringify(versionMeta));

  const fabricProfile = {
    id: `fabric-loader-${FABRIC}-${MC}`,
    mainClass: "net.fabricmc.loader.impl.launch.knot.KnotClient",
    libraries: [
      {
        name: "net.fabricmc:fabric-loader:0.19.3",
        downloads: {
          artifact: {
            path: "net/fabricmc/fabric-loader/0.19.3/fabric-loader-0.19.3.jar",
            sha1: sha1(fabricLib),
            size: fabricLib.byteLength,
            url: "https://example.test/fabric-loader.jar"
          }
        }
      }
    ]
  };

  const versionManifest = {
    latest: { release: MC, snapshot: MC },
    versions: [
      {
        id: MC,
        type: "release",
        url: `https://example.test/versions/${MC}.json`,
        sha1: sha1(versionMetaBuf)
      }
    ]
  };

  const fabricLoaders = [
    { loader: { version: FABRIC, stable: true }, intermediary: { version: "0.2.0" } }
  ];

  return {
    client,
    lwjgl,
    lwjglNative,
    fabricLib,
    asset,
    assetHash,
    assetIndex,
    assetIndexBuf,
    versionMeta,
    versionMetaBuf,
    fabricProfile,
    versionManifest,
    fabricLoaders
  };
}

/** Child inheritsFrom parent — both listed in manifest with sha1 over exact bytes. */
export function buildInheritanceFixtures() {
  const client = clientJarBytes();
  const asset = Buffer.from("asset-png-bytes");
  const assetHash = sha1(asset);
  const assetIndex = {
    objects: {
      "minecraft/lang/en_us.json": { hash: assetHash, size: asset.byteLength }
    }
  };
  const assetIndexBuf = Buffer.from(JSON.stringify(assetIndex));

  const parentMeta = {
    id: PARENT_ID,
    mainClass: "net.minecraft.client.main.Main",
    javaVersion: { component: "java-runtime-delta", majorVersion: 21 },
    assetIndex: {
      id: "26",
      sha1: sha1(assetIndexBuf),
      size: assetIndexBuf.byteLength,
      url: "https://example.test/indexes/26.json"
    },
    downloads: {
      client: {
        sha1: sha1(client),
        size: client.byteLength,
        url: "https://example.test/client.jar"
      }
    },
    libraries: [
      {
        name: "org.lwjgl:lwjgl:3.3.3",
        downloads: {
          artifact: {
            path: "org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3.jar",
            sha1: sha1("parent-lib"),
            size: 10,
            url: "https://example.test/parent-lib.jar"
          }
        }
      }
    ]
  };
  const parentBuf = Buffer.from(JSON.stringify(parentMeta));

  const childMeta = {
    id: MC,
    inheritsFrom: PARENT_ID,
    mainClass: "net.minecraft.client.main.Main",
    libraries: []
  };
  const childBuf = Buffer.from(JSON.stringify(childMeta));

  const fabricProfile = {
    id: `fabric-loader-${FABRIC}-${MC}`,
    mainClass: "net.fabricmc.loader.impl.launch.knot.KnotClient",
    libraries: []
  };

  const versionManifest = {
    latest: { release: MC, snapshot: MC },
    versions: [
      {
        id: MC,
        type: "release",
        url: `https://example.test/versions/${MC}.json`,
        sha1: sha1(childBuf)
      },
      {
        id: PARENT_ID,
        type: "release",
        url: `https://example.test/versions/${PARENT_ID}.json`,
        sha1: sha1(parentBuf)
      }
    ]
  };

  return {
    client,
    assetIndexBuf,
    parentMeta,
    parentBuf,
    childMeta,
    childBuf,
    fabricProfile,
    versionManifest,
    fabricLoaders: [{ loader: { version: FABRIC, stable: true } }]
  };
}

export function mockRuntimeSources(
  fx: ReturnType<typeof buildMinimalFixtures>,
  counters?: { fabricProfileFetches?: { count: number } }
): RuntimeMetadataSources {
  return {
    async fetchVersionManifest(): Promise<FetchedMetadata> {
      return fetchedFromBuffer(JSON.stringify(fx.versionManifest), "https://example.test/version_manifest_v2.json");
    },
    async fetchVersionMeta(url: string): Promise<FetchedMetadata> {
      return fetchedFromBuffer(fx.versionMetaBuf, url);
    },
    async fetchAssetIndex(url: string): Promise<FetchedMetadata> {
      return fetchedFromBuffer(fx.assetIndexBuf, url);
    },
    async fetchFabricLoaderList(_mc: string): Promise<FetchedMetadata> {
      return fetchedFromBuffer(JSON.stringify(fx.fabricLoaders));
    },
    async fetchFabricProfile(_mc: string, _loader: string): Promise<FetchedMetadata> {
      if (counters?.fabricProfileFetches) counters.fabricProfileFetches.count += 1;
      return fetchedFromBuffer(JSON.stringify(fx.fabricProfile));
    },
    async fetchUrlBytes(url: string): Promise<FetchedMetadata> {
      void url;
      throw new LauncherError(ErrorCode.HTTP_ERROR, "sidecar not found", { status: 404 });
    }
  };
}

export function mockInheritanceSources(
  fx: ReturnType<typeof buildInheritanceFixtures>,
  opts?: { corruptParent?: boolean; corruptChild?: boolean }
): RuntimeMetadataSources {
  return {
    async fetchVersionManifest(): Promise<FetchedMetadata> {
      return fetchedFromBuffer(JSON.stringify(fx.versionManifest));
    },
    async fetchVersionMeta(url: string): Promise<FetchedMetadata> {
      if (url.includes(PARENT_ID)) {
        const bytes = opts?.corruptParent ? Buffer.from('{"id":"tampered"}') : fx.parentBuf;
        return fetchedFromBuffer(bytes, url);
      }
      const bytes = opts?.corruptChild ? Buffer.from('{"id":"tampered-child"}') : fx.childBuf;
      return fetchedFromBuffer(bytes, url);
    },
    async fetchAssetIndex(url: string): Promise<FetchedMetadata> {
      return fetchedFromBuffer(fx.assetIndexBuf, url);
    },
    async fetchFabricLoaderList(): Promise<FetchedMetadata> {
      return fetchedFromBuffer(JSON.stringify(fx.fabricLoaders));
    },
    async fetchFabricProfile(): Promise<FetchedMetadata> {
      return fetchedFromBuffer(JSON.stringify(fx.fabricProfile));
    },
    async fetchUrlBytes(): Promise<FetchedMetadata> {
      throw new LauncherError(ErrorCode.HTTP_ERROR, "sidecar not found", { status: 404 });
    }
  };
}
