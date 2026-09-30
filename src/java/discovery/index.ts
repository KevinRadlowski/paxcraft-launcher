import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";

export interface JavaRequirement {
  majorVersion: number;
  component?: string;
}

export interface DiscoveredJava {
  javaPath: string;
  majorVersion: number;
  versionString: string;
  source: "JAVA_HOME" | "PATH" | "managed" | "known_path";
}

export function parseJavaVersionOutput(stderrOrStdout: string): { majorVersion: number; versionString: string } {
  // Examples:
  // openjdk version "21.0.2" 2024-01-16
  // java version "1.8.0_402"
  const m =
    /version\s+"([^"]+)"/i.exec(stderrOrStdout) ??
    /version\s+(\d+(?:\.\d+)*)/i.exec(stderrOrStdout);
  if (!m) {
    throw new LauncherError(ErrorCode.INVALID_JAVA_VERSION, "unable to parse java -version output", {
      output: stderrOrStdout.slice(0, 500)
    });
  }
  const versionString = m[1]!;
  const major = majorFromVersionString(versionString);
  return { majorVersion: major, versionString };
}

export function majorFromVersionString(versionString: string): number {
  const parts = versionString.split(/[._]/);
  if (parts[0] === "1" && parts[1]) {
    return Number(parts[1]);
  }
  const n = Number(parts[0]);
  if (!Number.isInteger(n) || n <= 0) {
    throw new LauncherError(ErrorCode.INVALID_JAVA_VERSION, `invalid java version: ${versionString}`);
  }
  return n;
}

export function isJavaCompatible(discovered: DiscoveredJava, req: JavaRequirement): boolean {
  return discovered.majorVersion >= req.majorVersion;
}

/**
 * Probe a known java executable with fixed argv (never shell, never network-derived command).
 */
export async function probeJavaBinary(javaPath: string): Promise<DiscoveredJava> {
  await access(javaPath, fsConstants.X_OK).catch(async () => {
    await access(javaPath, fsConstants.F_OK);
  });
  const output = await runJavaVersion(javaPath);
  const parsed = parseJavaVersionOutput(output);
  return {
    javaPath,
    majorVersion: parsed.majorVersion,
    versionString: parsed.versionString,
    source: "known_path"
  };
}

function runJavaVersion(javaPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(javaPath, ["-version"], {
      shell: false,
      windowsHide: true
    });
    let out = "";
    child.stderr.on("data", (d) => {
      out += String(d);
    });
    child.stdout.on("data", (d) => {
      out += String(d);
    });
    child.on("error", (e) => reject(e));
    child.on("close", (code) => {
      if (code !== 0 && !out) {
        reject(new LauncherError(ErrorCode.INVALID_JAVA_VERSION, `java -version failed (${code})`));
        return;
      }
      resolve(out);
    });
  });
}

export interface DiscoverJavaOptions {
  managedJavaPath?: string;
  extraCandidates?: string[];
  /** If false, do not execute probes (unit tests with injected results). */
  probe?: boolean;
}

/**
 * Discover local Java runtimes on Windows-friendly locations.
 * Does NOT install Java. Does NOT modify PATH/JAVA_HOME.
 */
export async function discoverJava(opts: DiscoverJavaOptions = {}): Promise<DiscoveredJava[]> {
  const candidates: Array<{ path: string; source: DiscoveredJava["source"] }> = [];

  if (opts.managedJavaPath) {
    candidates.push({ path: opts.managedJavaPath, source: "managed" });
  }
  if (process.env.JAVA_HOME) {
    const home = process.env.JAVA_HOME;
    candidates.push({
      path: path.join(home, "bin", process.platform === "win32" ? "java.exe" : "java"),
      source: "JAVA_HOME"
    });
  }
  // PATH bare name — only if we will probe; spawn without shell uses PATH lookup when path has no sep
  candidates.push({
    path: process.platform === "win32" ? "java.exe" : "java",
    source: "PATH"
  });
  for (const p of opts.extraCandidates ?? []) {
    candidates.push({ path: p, source: "known_path" });
  }

  if (opts.probe === false) {
    return [];
  }

  const found: DiscoveredJava[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c.path)) continue;
    seen.add(c.path);
    try {
      const probed = await probeJavaBinary(c.path);
      found.push({ ...probed, source: c.source });
    } catch {
      // skip unavailable
    }
  }
  return found;
}

export function pickCompatibleJava(
  discovered: DiscoveredJava[],
  req: JavaRequirement
): DiscoveredJava {
  const ok = discovered.find((d) => isJavaCompatible(d, req));
  if (!ok) {
    if (discovered.length === 0) {
      throw new LauncherError(ErrorCode.MISSING_JAVA, "no Java runtime discovered", { required: req });
    }
    throw new LauncherError(ErrorCode.INCOMPATIBLE_JAVA, "no compatible Java runtime", {
      required: req,
      found: discovered.map((d) => d.majorVersion)
    });
  }
  return ok;
}

/**
 * Managed Java layout placeholder:
 * <javaRoot>/<runtimeIdentity>/bin/java(.exe)
 * No automatic download URL is invented in this lot.
 */
export function managedJavaBinaryPath(javaRoot: string, runtimeIdentity: string): string {
  return path.join(
    javaRoot,
    runtimeIdentity,
    "bin",
    process.platform === "win32" ? "java.exe" : "java"
  );
}
