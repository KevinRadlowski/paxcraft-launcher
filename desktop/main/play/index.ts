export { PlayDesktopService, resolvePlayEligibility } from "./play-desktop-service.js";
export type {
  PlayBackendPort,
  PlayBackendStartResult,
  PlayEventSink,
  PlayEligibilityContext
} from "./play-types.js";
export { FakePlayBackend, EmptyPlayBackend } from "./fake-play-backend.js";
export { createRealPlayBackend } from "./real-play-backend.js";
export { buildPlayContext, loadPlayDepsModules } from "./play-deps-builder.js";
export {
  shouldUseFakePlayBackend,
  assertFakePlayFixturePayload,
  FAKE_PLAY_FIXTURES,
  defaultFakePlayState,
  loadFakePlayStore,
  saveFakePlayStore,
  clearFakePlayStore,
  parseFakePlayStore
} from "./fake-play-store.js";
export type { FakePlayFixtureId, FakePlayStoreFile } from "./fake-play-store.js";
export {
  normalizePlayStatus,
  tryNormalizePlayStatusEvent,
  assertEmptyPlayPayload,
  assertSimulateExitPayload
} from "./play-dto.js";
export { mapPlayError } from "./play-errors.js";
