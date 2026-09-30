export type OsFamily = "windows" | "osx" | "linux" | "unknown";
export type CpuArch = "x64" | "x86" | "arm64" | "arm" | "unknown";

export interface PlatformInfo {
  os: OsFamily;
  arch: CpuArch;
  /** Raw Node process.platform */
  nodePlatform: NodeJS.Platform;
  /** Raw Node process.arch */
  nodeArch: string;
  /** Minecraft rule os.name value (windows|osx|linux) */
  minecraftOsName: "windows" | "osx" | "linux" | null;
}

export function detectPlatform(
  nodePlatform: NodeJS.Platform = process.platform,
  nodeArch: string = process.arch
): PlatformInfo {
  let os: OsFamily = "unknown";
  let minecraftOsName: PlatformInfo["minecraftOsName"] = null;
  if (nodePlatform === "win32") {
    os = "windows";
    minecraftOsName = "windows";
  } else if (nodePlatform === "darwin") {
    os = "osx";
    minecraftOsName = "osx";
  } else if (nodePlatform === "linux") {
    os = "linux";
    minecraftOsName = "linux";
  }

  let arch: CpuArch = "unknown";
  if (nodeArch === "x64") arch = "x64";
  else if (nodeArch === "ia32") arch = "x86";
  else if (nodeArch === "arm64") arch = "arm64";
  else if (nodeArch === "arm") arch = "arm";

  return { os, arch, nodePlatform, nodeArch, minecraftOsName };
}

/** Primary SweetCraft desktop target for lot 0.3A. */
export function windowsX64Platform(): PlatformInfo {
  return detectPlatform("win32", "x64");
}
