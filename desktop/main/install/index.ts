export { InstallDesktopService } from "./install-desktop-service.js";
export type {
  InstallBackendPort,
  InstallEventSink,
  InstallStatusSnapshot,
  InstallMutation
} from "./install-types.js";
export { FakeInstallBackend, EmptyInstallBackend } from "./fake-install-backend.js";
export { createRealInstallBackend } from "./real-install-backend.js";
export {
  shouldUseFakeInstallBackend,
  assertFakeInstallFixturePayload,
  parseFakeInstallStore,
  loadFakeInstallStore,
  saveFakeInstallStore,
  clearFakeInstallStore,
  FAKE_INSTALL_FIXTURES,
  defaultFakeInstallState,
  fixtureToState
} from "./fake-install-store.js";
export type { FakeInstallFixtureId, FakeInstallStoreFile } from "./fake-install-store.js";
export {
  assertEmptyInstallPayload,
  snapshotToStatusDto,
  recoverabilityForReadiness
} from "./install-dto.js";
export {
  normalizeInstallProgress,
  tryNormalizeInstallProgressEvent,
  mapOperationPhase
} from "./install-progress.js";
export {
  createInstallProgressAggregator,
  type InstallProgressAggregatorStats
} from "./install-progress-aggregator.js";
export { InstallByteSpeedTracker, computeEtaSeconds } from "./install-progress-speed.js";
export {
  mapInstallError,
  extractInstallErrorCode,
  isInstallErrorRetryable
} from "./install-errors.js";
