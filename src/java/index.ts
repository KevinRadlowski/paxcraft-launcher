export type { JavaRequirement, DiscoveredJava, DiscoverJavaOptions } from "./discovery/index.js";
export {
  parseJavaVersionOutput,
  majorFromVersionString,
  isJavaCompatible,
  discoverJava,
  pickCompatibleJava,
  managedJavaBinaryPath,
  probeJavaBinary
} from "./discovery/index.js";
export { listManagedJavaCandidates } from "./discovery/managed.js";
export {
  ensureCompatibleJava,
  provisionManagedJava,
  findExtractedJavaBinary,
  readExistingManagedJava,
  acquireJavaProvisionLock,
  releaseJavaProvisionLock,
  inspectJavaProvisionLock
} from "./provision/index.js";
export type {
  EnsureCompatibleJavaOptions,
  EnsureCompatibleJavaResult,
  ProvisionManagedJavaOptions,
  ProvisionManagedJavaResult,
  JavaProvisionPhase,
  ManagedJavaRuntimeMeta
} from "./provision/index.js";
export {
  resolveAdoptiumTemurinJdk,
  managedJavaIdentity,
  ADOPTIUM_PROVIDER_ID,
  ADOPTIUM_DISTRIBUTION
} from "./provider/index.js";
export type { ManagedJavaArtifact, ManagedJavaArtifactRequest } from "./provider/index.js";
