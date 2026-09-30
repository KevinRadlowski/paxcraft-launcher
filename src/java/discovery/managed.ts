/**
 * Scan canonical managed Java runtimes under runtimeRoot/java/runtimes/.
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { isPathInside } from "../../instance/security/index.js";
import { RuntimePaths } from "../../minecraft/runtime/paths.js";
import { probeJavaBinary, type DiscoveredJava } from "./index.js";
import { readManagedJavaMeta } from "../provision/meta.js";

export async function listManagedJavaCandidates(runtimeRoot: string): Promise<DiscoveredJava[]> {
  const paths = new RuntimePaths(runtimeRoot);
  const runtimesDir = paths.javaRuntimesDir();
  let names: string[];
  try {
    names = await readdir(runtimesDir);
  } catch {
    return [];
  }
  const out: DiscoveredJava[] = [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const runtimeDir = path.join(runtimesDir, name);
    const meta = await readManagedJavaMeta(runtimeDir);
    if (!meta) continue;
    const javaPath = path.join(runtimeDir, ...meta.javaRelativePath.split("/"));
    if (!isPathInside(runtimeDir, javaPath)) continue;
    try {
      const probed = await probeJavaBinary(javaPath);
      out.push({ ...probed, source: "managed" });
    } catch {
      // skip broken installs
    }
  }
  return out;
}
