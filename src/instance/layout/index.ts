import path from "node:path";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";

/**
 * Canonical instance layout under an isolated instanceRoot.
 *
 * <instanceRoot>/
 *   mods/
 *   config/
 *   resourcepacks/
 *   logs/
 *   launcher/
 *     state.json
 *     lock.json
 *     downloads/
 *     tmp/
 */
export class InstancePaths {
  readonly root: string;

  constructor(instanceRoot: string) {
    if (typeof instanceRoot !== "string" || !instanceRoot.trim()) {
      throw new LauncherError(ErrorCode.INSTANCE_ROOT_REQUIRED, "instanceRoot is required");
    }
    this.root = path.resolve(instanceRoot);
  }

  modsDir(): string {
    return path.join(this.root, "mods");
  }

  configDir(): string {
    return path.join(this.root, "config");
  }

  resourcePacksDir(): string {
    return path.join(this.root, "resourcepacks");
  }

  logsDir(): string {
    return path.join(this.root, "logs");
  }

  launcherDir(): string {
    return path.join(this.root, "launcher");
  }

  stateFile(): string {
    return path.join(this.launcherDir(), "state.json");
  }

  lockFile(): string {
    return path.join(this.launcherDir(), "lock.json");
  }

  downloadsDir(): string {
    return path.join(this.launcherDir(), "downloads");
  }

  tmpDir(): string {
    return path.join(this.launcherDir(), "tmp");
  }

  /** Absolute path for a managed relative target (e.g. mods/foo.jar). */
  absoluteForRelative(relativePosix: string): string {
    const norm = relativePosix.replace(/\\/g, "/");
    return path.join(this.root, ...norm.split("/"));
  }
}
