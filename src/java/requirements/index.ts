export type { JavaRequirement, DiscoveredJava } from "../discovery/index.js";
export {
  parseJavaVersionOutput,
  majorFromVersionString,
  isJavaCompatible,
  discoverJava,
  pickCompatibleJava,
  managedJavaBinaryPath,
  probeJavaBinary
} from "../discovery/index.js";
export { listManagedJavaCandidates } from "../discovery/managed.js";
export { ensureCompatibleJava, provisionManagedJava } from "../provision/index.js";
export { resolveAdoptiumTemurinJdk } from "../provider/index.js";
