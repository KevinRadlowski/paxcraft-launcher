/**
 * Test-facing re-exports / shims for pure trust helpers.
 * Avoids importing Electron lifecycle in node:test.
 */
export {
  assertIpcResultRoundTrip,
  createFileRendererTarget,
  createRendererTrustPolicy,
  createRendererTrustPolicyForRuntime,
  evaluateIpcSenderTrust,
  ipcErr,
  ipcOk,
  isAllowedExternalUrl,
  isAllowedNavigation,
  isTrustedIpcSenderUrl,
  isTrustedRendererUrl,
  parseDevServerUrl,
  resolveDesktopRuntimeMode,
  unwrapIpcResult,
  usesDevelopmentCsp,
  productionCsp,
  developmentCsp,
  cspForPolicy
} from "../../desktop/shared/index.js";

/** Alias kept for existing test call sites. */
export { resolveDesktopRuntimeMode as resolveDesktopRuntimeModeForTest } from "../../desktop/shared/index.js";
