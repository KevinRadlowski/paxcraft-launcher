/**
 * Ensure a compatible Java exists — discover first, provision managed when needed.
 */

import type { HttpClient } from "../../distribution/http/index.js";
import type { ByteSource } from "../../download/engine/types.js";
import type { ProgressEmitter } from "../../instance/events/index.js";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import {
  discoverJava,
  pickCompatibleJava,
  type DiscoveredJava,
  type DiscoverJavaOptions,
  type JavaRequirement
} from "../discovery/index.js";
import { listManagedJavaCandidates } from "../discovery/managed.js";
import {
  provisionManagedJava,
  type ProvisionManagedJavaOptions
} from "./provision.js";
import type { ManagedJavaArtifact } from "../provider/adoptium.js";

export interface EnsureCompatibleJavaOptions {
  readonly requirement: JavaRequirement;
  readonly runtimeRoot: string;
  readonly http: HttpClient;
  readonly byteSource?: ByteSource;
  readonly emitter?: ProgressEmitter;
  readonly signal?: AbortSignal;
  /** When true, do not probe JAVA_HOME / PATH / extras (E2E isolation). */
  readonly skipSystemJava?: boolean;
  /** When false, never download — offline fail-closed. Default true. */
  readonly allowProvision?: boolean;
  readonly forceStaleLock?: boolean;
  readonly artifactOverride?: ManagedJavaArtifact;
  readonly extraCandidates?: string[];
}

export interface EnsureCompatibleJavaResult {
  readonly java: DiscoveredJava;
  readonly provisioned: boolean;
  readonly reusedManaged: boolean;
}

async function discoverAll(opts: EnsureCompatibleJavaOptions): Promise<DiscoveredJava[]> {
  const managed = await listManagedJavaCandidates(opts.runtimeRoot);
  if (opts.skipSystemJava) {
    return managed;
  }
  const discoverOpts: DiscoverJavaOptions = {
    ...(opts.extraCandidates ? { extraCandidates: opts.extraCandidates } : {})
  };
  const system = await discoverJava(discoverOpts);
  // Managed first (selection preference).
  const merged: DiscoveredJava[] = [...managed];
  const seen = new Set(managed.map((m) => m.javaPath));
  for (const s of system) {
    if (seen.has(s.javaPath)) continue;
    seen.add(s.javaPath);
    merged.push(s);
  }
  return merged;
}

/**
 * Selection policy:
 * 1. compatible managed → reuse
 * 2. else compatible system (unless skipSystemJava)
 * 3. else provision managed (if allowProvision)
 * 4. else MISSING_JAVA / INCOMPATIBLE_JAVA / JAVA_PROVIDER_*
 */
export async function ensureCompatibleJava(
  opts: EnsureCompatibleJavaOptions
): Promise<EnsureCompatibleJavaResult> {
  opts.emitter?.emit("PLAY_PROGRESS", { phase: "CHECKING_JAVA" });

  const first = await discoverAll(opts);
  try {
    const java = pickCompatibleJava(first, opts.requirement);
    return {
      java,
      provisioned: false,
      reusedManaged: java.source === "managed"
    };
  } catch (e) {
    if (!LauncherError.isLauncherError(e)) throw e;
    if (e.code !== ErrorCode.MISSING_JAVA && e.code !== ErrorCode.INCOMPATIBLE_JAVA) throw e;
    if (opts.allowProvision === false) throw e;
  }

  const provisionOpts: ProvisionManagedJavaOptions = {
    runtimeRoot: opts.runtimeRoot,
    requirement: opts.requirement,
    http: opts.http,
    ...(opts.byteSource ? { byteSource: opts.byteSource } : {}),
    ...(opts.emitter ? { emitter: opts.emitter } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
    ...(opts.forceStaleLock !== undefined ? { forceStaleLock: opts.forceStaleLock } : {}),
    ...(opts.artifactOverride ? { artifactOverride: opts.artifactOverride } : {})
  };
  const provisioned = await provisionManagedJava(provisionOpts);
  return {
    java: provisioned.discovered,
    provisioned: !provisioned.reusedExisting,
    reusedManaged: provisioned.reusedExisting
  };
}
