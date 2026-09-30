export { LAUNCHER_VERSION, PRODUCT_NAME } from "./version.js";
export { ErrorCode, LauncherError } from "./core/errors/index.js";
export {
  buildChannelSigningPayload,
  buildReleaseSigningPayload,
  CHANNEL_SIGNING_PAYLOAD_ID,
  RELEASE_SIGNING_PAYLOAD_ID,
  sha256Hex,
  signEd25519Pem,
  generateEphemeralEd25519Pem,
  verifyEd25519Pem
} from "./core/crypto/index.js";
export {
  MapTrustedKeyStore,
  loadTrustedKeyStoreFromFile,
  PRODUCTION_RELEASE_KEY_ID
} from "./core/trust/index.js";
export {
  parseChannelBytes,
  parseChannelJson,
  verifyChannelSignature,
  CHANNEL_SCHEMA_VERSION
} from "./core/channel/index.js";
export type { ChannelDescriptor, VerifiedChannel, ReleaseChannelName } from "./core/channel/index.js";
export {
  parseReleaseBytes,
  parseReleaseJson,
  verifyReleaseSignature,
  assertReleaseBytesHash,
  assertChannelReleaseConsistency,
  RELEASE_SCHEMA_VERSION,
  RELEASE_FILES_BASE
} from "./core/release/index.js";
export type { ReleaseDoc, VerifiedRelease } from "./core/release/index.js";
export {
  parseClientManifestBytes,
  parseClientManifestJson,
  assertManifestBytesHash,
  CLIENT_APPLY_MODES,
  FORBIDDEN_CLIENT_POLICIES
} from "./core/manifest/index.js";
export type { ClientManifest, ManifestResourcePack, ClientApplyMode } from "./core/manifest/index.js";
export { resolveLatestRelease } from "./core/resolve/index.js";
export type { TrustedResolvedRelease, ResolveLatestReleaseOptions } from "./core/resolve/index.js";
export { FetchHttpClient, MockHttpClient } from "./distribution/http/index.js";
export { DEFAULT_PRODUCT_BASE, channelUrl, joinProductUrl } from "./distribution/urls/index.js";
export {
  checkAntiRollback,
  createEmptyAntiRollbackState,
  withAcceptedRelease,
  FileAntiRollbackStore
} from "./instance/state/index.js";
export { InstancePaths } from "./instance/layout/index.js";
export { resolveSafeInstancePath } from "./instance/security/index.js";
export {
  InstanceStateStore,
  createEmptyInstanceState,
  parseInstanceStateJson
} from "./instance/state/instanceState.js";
export type { InstanceState, ManagedFileRecord } from "./instance/state/instanceState.js";
export { buildInstallationPlan, formatPlanSummaryHuman } from "./instance/plan/index.js";
export type { InstallationPlan, PlanEntry, PlanAction } from "./instance/plan/index.js";
export { applyInstallation } from "./instance/apply/index.js";
export type { ApplyResult, ApplyOptions, PendingInstallationCommit } from "./instance/apply/index.js";
export { auditInstance, planRepair } from "./instance/audit/index.js";
export { InstanceLock, assertValidLockLease } from "./instance/lock/index.js";
export type { InstanceLockLease, InstanceLockInfo } from "./instance/lock/index.js";
export { ProgressEmitter } from "./instance/events/index.js";
export type { ProgressEvent } from "./instance/events/index.js";
export { DownloadEngine, isRetryableDownloadError, parseContentLengthHeader, MAX_DOWNLOAD_REDIRECTS } from "./download/engine/index.js";
export { FetchByteSource, MockByteSource } from "./download/engine/sources.js";
export { ProviderResolver } from "./download/providers/index.js";
export { sha1Integrity, sha256Integrity } from "./minecraft/integrity/index.js";
export type { IntegrityExpectation, HashAlgorithm } from "./minecraft/integrity/index.js";
export {
  loadSha1VerifiedJson,
  loadVerifiedAssetIndexJson,
  parseJsonFromBytes,
  fetchedFromBuffer
} from "./minecraft/metadata/bytes.js";
export type { FetchedMetadata } from "./minecraft/metadata/bytes.js";
export { detectPlatform, windowsX64Platform } from "./platform/index.js";
export type { PlatformInfo } from "./platform/index.js";
export { evaluateRules, parseMinecraftRule } from "./minecraft/rules/index.js";
export { RuntimePaths } from "./minecraft/runtime/paths.js";
export { buildRuntimeInstallationPlan } from "./minecraft/runtime/plan.js";
export type { RuntimeMetadataSources } from "./minecraft/runtime/plan.js";
export { auditRuntime, planRuntimeRepair } from "./minecraft/audit/index.js";
export { extractZipSecure } from "./minecraft/natives/index.js";
export { discoverJava, pickCompatibleJava, parseJavaVersionOutput } from "./java/discovery/index.js";
export { listManagedJavaCandidates } from "./java/discovery/managed.js";
export type { JavaRequirement, DiscoveredJava } from "./java/discovery/index.js";
export {
  ensureCompatibleJava,
  provisionManagedJava,
  resolveAdoptiumTemurinJdk,
  managedJavaIdentity
} from "./java/index.js";
export type { ManagedJavaArtifact, EnsureCompatibleJavaResult } from "./java/index.js";
export { mergeMinecraftAndFabric, selectExactFabricLoader } from "./minecraft/fabric/index.js";
export {
  prepareLaunch,
  runPreparedLaunch,
  buildLaunchSpec,
  createTestLaunchIdentity,
  sanitizeLaunchSpecForLogging,
  materializeLaunchArguments,
  MockMinecraftProcessRunner,
  NodeMinecraftProcessRunner,
  GameProcessLock
} from "./launch/index.js";
export type { LaunchSpec, LaunchIdentity, PreparedLaunch, GameProcessResult } from "./launch/index.js";
export {
  createFixtureOAuthConfig,
  createMicrosoftAuthorizationFlow,
  completeAuthFromCallbackUrl,
  createLaunchIdentityFromMinecraftSession,
  normalizeMinecraftUuid,
  InMemoryAuthTokenStore,
  logoutAccount
} from "./auth/index.js";
export {
  inspectInstanceStatus,
  installInstance,
  updateInstance,
  repairInstance,
  prepareMinecraftRuntime,
  formatStatusHuman,
  statusToJson,
  operationToJson
} from "./application/index.js";
export type {
  InstanceStatusReport,
  OperationResult,
  OrchestratorDependencies,
  InstanceStatusCode
} from "./application/index.js";
export { defaultInstanceRoot, defaultRuntimeRoot, defaultLauncherDataDir } from "./instance/paths/index.js";
export {
  PRODUCT_USER_DATA_DIR_NAME,
  LAUNCHER_DATA_DIR_NAME,
  DEFAULT_INSTANCE_ID,
  resolveProductUserDataRoot,
  resolveLauncherDataRoot,
  migrateLegacyLauncherDataIfNeeded
} from "./instance/paths/index.js";
