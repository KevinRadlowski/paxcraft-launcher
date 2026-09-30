import path from "node:path";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";

/**
 * Runtime layout under an explicit runtimeRoot (never implicit .minecraft):
 *
 * <runtimeRoot>/
 *   minecraft/
 *     versions/<id>/<id>.json
 *     versions/<id>/<id>.jar
 *     libraries/...
 *     assets/indexes/
 *     assets/objects/
 *     natives/<minecraftVersion>-<loader>/
 *   java/
 *     runtimes/<identity>/
 *   launcher/
 *     runtime-state.json
 *     lock.json
 *     tmp/
 */
export class RuntimePaths {
  readonly root: string;

  constructor(runtimeRoot: string) {
    if (!runtimeRoot?.trim()) {
      throw new LauncherError(ErrorCode.RUNTIME_ROOT_REQUIRED, "runtimeRoot is required");
    }
    this.root = path.resolve(runtimeRoot);
  }

  minecraftDir(): string {
    return path.join(this.root, "minecraft");
  }

  versionsDir(): string {
    return path.join(this.minecraftDir(), "versions");
  }

  versionDir(id: string): string {
    return path.join(this.versionsDir(), id);
  }

  versionJar(id: string): string {
    return path.join(this.versionDir(id), `${id}.jar`);
  }

  versionJson(id: string): string {
    return path.join(this.versionDir(id), `${id}.json`);
  }

  librariesDir(): string {
    return path.join(this.minecraftDir(), "libraries");
  }

  libraryFile(relativePath: string): string {
    return path.join(this.librariesDir(), ...relativePath.split("/"));
  }

  assetsDir(): string {
    return path.join(this.minecraftDir(), "assets");
  }

  assetIndexFile(id: string): string {
    return path.join(this.assetsDir(), "indexes", `${id}.json`);
  }

  assetObjectFile(hash: string): string {
    const h = hash.toLowerCase();
    return path.join(this.assetsDir(), "objects", h.slice(0, 2), h);
  }

  nativesDir(minecraftVersion: string, fabricLoaderVersion: string): string {
    return path.join(this.minecraftDir(), "natives", `${minecraftVersion}-${fabricLoaderVersion}`);
  }

  javaRuntimesDir(): string {
    return path.join(this.root, "java", "runtimes");
  }

  launcherDir(): string {
    return path.join(this.root, "launcher");
  }

  stateFile(): string {
    return path.join(this.launcherDir(), "runtime-state.json");
  }

  lockFile(): string {
    return path.join(this.launcherDir(), "lock.json");
  }

  tmpDir(): string {
    return path.join(this.launcherDir(), "tmp");
  }
}
