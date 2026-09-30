export { AuthDesktopService, resolveDeterministicAccount } from "./auth-desktop-service.js";
export type {
  AuthAccountRecord,
  AuthBackendPort,
  AuthBackendLoginResult,
  AuthEventSink
} from "./auth-desktop-service.js";
export { FakeAuthBackend, EmptyAuthBackend } from "./fake-auth-backend.js";
export type { FakeAuthScenario, FakeAuthBackendOptions } from "./fake-auth-backend.js";
export {
  shouldUseFakeAuthBackend,
  assertFakeAuthFixturePayload,
  parseFakeAuthStore,
  loadFakeAuthStore,
  saveFakeAuthStore,
  clearFakeAuthStore,
  FAKE_AUTH_FIXTURES
} from "./fake-auth-store.js";
export type { FakeAuthFixtureId, FakeAuthStoreFile } from "./fake-auth-store.js";
export { createRealAuthBackend } from "./real-auth-backend.js";
export {
  assertAccountIdPayload,
  assertLoginPayload,
  assertOptionalAccountIdPayload,
  normalizeAuthActionResult,
  normalizeAuthProgressDto,
  normalizeAuthStateDto,
  normalizeSafeAccount,
  normalizeSafeAccountList,
  tryNormalizeAuthProgressEvent,
  tryNormalizeAuthStateEvent
} from "./auth-dto.js";
export {
  authStateForErrorCode,
  extractErrorCode,
  mapAuthCodeToUiError
} from "./auth-errors.js";
