import type { IntegrityExpectation } from "../integrity/index.js";
import type { ResolvedMinecraftRuntime } from "../fabric/index.js";
import type { AssetObject } from "../assets/index.js";
import type { JavaRequirement } from "../../java/requirements/index.js";

export type RuntimePlanAction =
  | "DOWNLOAD"
  | "KEEP"
  | "REPAIR"
  | "EXTRACT_NATIVE"
  | "WRITE_METADATA"
  | "SKIP";

export interface RuntimePlanEntry {
  action: RuntimePlanAction;
  kind: "client" | "library" | "native" | "assetIndex" | "asset" | "metadata";
  id: string;
  relativePath: string;
  url?: string;
  integrity?: IntegrityExpectation;
  expectedSize?: number;
  extractExclude?: string[];
  reason: string;
}

export interface RuntimeInstallationPlan {
  dryRun: boolean;
  minecraftVersion: string;
  fabricLoaderVersion: string;
  mainClass: string;
  javaRequirement: JavaRequirement | null;
  entries: RuntimePlanEntry[];
  summary: {
    download: number;
    keep: number;
    repair: number;
    extractNative: number;
    writeMetadata: number;
  };
  resolved: ResolvedMinecraftRuntime;
  assets: AssetObject[];
}
