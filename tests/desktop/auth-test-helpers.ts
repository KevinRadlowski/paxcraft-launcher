export {

  AuthDesktopService,

  FakeAuthBackend,

  assertAccountIdPayload,

  assertLoginPayload,

  assertFakeAuthFixturePayload,

  clearFakeAuthStore,

  loadFakeAuthStore,

  parseFakeAuthStore,

  shouldUseFakeAuthBackend,

  FAKE_AUTH_FIXTURES,

  normalizeAuthProgressDto,

  normalizeAuthStateDto,

  tryNormalizeAuthStateEvent

} from "../../desktop/main/auth/index.js";

export {

  createRendererTrustPolicy,

  evaluateIpcSenderTrust,

  FORBIDDEN_AUTH_SECRET_KEYS

} from "../../desktop/shared/index.js";

