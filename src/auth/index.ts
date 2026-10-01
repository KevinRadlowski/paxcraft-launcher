export type { Clock } from "./clock.js";
export { SystemClock, FakeClock, isExpired, DEFAULT_TOKEN_SKEW_MS } from "./clock.js";
export {
  redactAuthValue,
  redactAuthString,
  safeAuthErrorDetails,
  normalizeOAuthErrorCode,
  sanitizeAuthHttpRequest,
  sanitizeAuthHeaders,
  sanitizeMicrosoftTokenSet,
  sanitizeXboxLiveToken,
  sanitizeXstsToken,
  sanitizeMinecraftAccessToken,
  sanitizeOAuthFlowState,
  AUTH_REDACTED
} from "./redaction.js";
export { computeExpiresAtMs } from "./expiry.js";
export type { MicrosoftOAuthConfig } from "./config.js";
export {
  createMicrosoftOAuthConfig,
  createFixtureOAuthConfig,
  assertMicrosoftClientIdUuid,
  FIXTURE_MS_CLIENT_ID,
  DEFAULT_MS_AUTHORITY,
  DEFAULT_MS_AUTHORIZATION_ENDPOINT,
  DEFAULT_MS_TOKEN_ENDPOINT,
  DEFAULT_MS_OAUTH_SCOPES,
  DEFAULT_LOOPBACK_REDIRECT_URI
} from "./config.js";
export type { LauncherAuthConfig } from "./launcherConfig.js";
export {
  resolveLauncherAuthConfig,
  createOAuthConfigFromLauncherAuth,
  assertLiveAuthEnabled,
  isLiveAuthAllowed,
  ENV_MICROSOFT_CLIENT_ID,
  ENV_ALLOW_LIVE_AUTH,
  PRODUCT_MICROSOFT_CLIENT_ID
} from "./launcherConfig.js";
export { assertPaxLiveAuthNetworkAllowed } from "../product/paxNetworkConfig.js";
export {
  generateCodeVerifier,
  generateOAuthState,
  computeCodeChallengeS256,
  createOAuthFlowState,
  assertFlowUsable,
  consumeFlow,
  DEFAULT_OAUTH_FLOW_TTL_MS
} from "./pkce.js";
export type { OAuthFlowState } from "./pkce.js";
export { createMicrosoftAuthorizationFlow, authorizationUrlContainsCodeVerifier } from "./oauth/flow.js";
export {
  exchangeAuthorizationCode,
  refreshMicrosoftToken,
  parseMicrosoftTokenResponse,
  sanitizeOAuthErrorResponse,
  isOAuthReauthErrorCode,
  OAUTH_REAUTH_ERROR_CODES
} from "./oauth/exchange.js";
export type { MicrosoftTokenSet } from "./oauth/exchange.js";
export {
  createLoopbackCallbackWaiter,
  startLoopbackOAuthCallbackServer,
  parseOAuthCallbackUrl,
  MAX_CALLBACK_URL_BYTES
} from "./oauth/callback.js";
export type { OAuthCallbackResult, OAuthCallbackWaiter, LoopbackCallback } from "./oauth/callback.js";
export type { SystemBrowser, ExecFileLike } from "./browser.js";
export {
  FakeSystemBrowser,
  WindowsSystemBrowser,
  DefaultSystemBrowser,
  assertHttpsAuthUrl,
  WINDOWS_URL_OPEN_EXECUTABLE,
  windowsUrlOpenArgs
} from "./browser.js";
export { formatSafeAuthDiagnostic } from "./diagnostic.js";
export type { SafeAuthDiagnostic } from "./diagnostic.js";
export { signInInteractively } from "./interactive.js";
export type { SignInInteractivelyDeps, SignInInteractivelyResult } from "./interactive.js";
export type {
  AuthHttpTransport,
  AuthHttpRequest,
  AuthHttpResponse,
  SafeAuthHttpCall,
  AuthFetchLike
} from "./http/transport.js";
export {
  FetchAuthHttpTransport,
  MockAuthHttpTransport,
  DEFAULT_AUTH_TIMEOUT_MS,
  DEFAULT_AUTH_MAX_BYTES,
  parseJsonAuthBody
} from "./http/transport.js";
export {
  authenticateXboxLive,
  authorizeXsts,
  parseXboxTokenResponse,
  XBOX_USER_AUTH_URL,
  XSTS_AUTH_URL
} from "./xbox/index.js";
export type { XboxLiveToken, XstsToken } from "./xbox/index.js";
export {
  loginWithXbox,
  fetchMinecraftEntitlements,
  fetchMinecraftProfile,
  parseMinecraftLoginResponse,
  parseEntitlements,
  parseMinecraftProfile,
  ownsMinecraftJava,
  assertOwnsMinecraftJava,
  MC_LOGIN_WITH_XBOX_URL,
  MC_ENTITLEMENTS_URL,
  MC_PROFILE_URL
} from "./minecraft/services.js";
export {
  classifyMinecraftServiceError,
  minecraftLoginHttpError
} from "./minecraft/serviceErrors.js";
export type { MinecraftServiceReason, MinecraftServiceErrorClassification } from "./minecraft/serviceErrors.js";
export type {
  MinecraftAccessToken,
  MinecraftEntitlements,
  MinecraftProfile
} from "./minecraft/services.js";
export { normalizeMinecraftUuid } from "./minecraft/uuid.js";
export { createLaunchIdentityFromMinecraftSession } from "./bridge.js";
export type { MinecraftAuthSession } from "./session.js";
export { buildSession } from "./session.js";
export type { AuthTokenStore, PersistedAuthCredentials } from "./store.js";
export { InMemoryAuthTokenStore } from "./store.js";
export type { SecureRefreshTokenStore } from "./secureStore/types.js";
export {
  MemorySecureRefreshTokenStore,
  UnavailableSecureRefreshTokenStore
} from "./secureStore/types.js";
export {
  WindowsDpapiSecureRefreshTokenStore,
  createPlatformSecureRefreshTokenStore
} from "./secureStore/windowsDpapi.js";
export { SecureBackedAuthTokenStore } from "./secureStore/backedStore.js";
export type { AccountRecord } from "./account.js";
export { InMemoryAccountRegistry, accountIdFromMinecraftUuid } from "./account.js";
export type { AccountRegistry } from "./accountsFile.js";
export { FileAccountRegistry, accountsRegistryPath } from "./accountsFile.js";
export type { AuthState } from "./state.js";
export { AuthStateMachine } from "./state.js";
export {
  completeAuthFromCallbackUrl,
  completeAuthFromCallbackResult,
  refreshAuthSession,
  restoreAuthSession,
  sessionNeedsRefresh,
  logoutAccount
} from "./pipeline.js";
