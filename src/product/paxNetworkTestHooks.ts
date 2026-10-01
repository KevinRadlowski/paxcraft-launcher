/**
 * PACK-PAX-05.1 — Test-only hooks for Pax network configuration.
 *
 * Product entrypoints (CLI, Electron Main, orchestrator production deps)
 * MUST NOT import this module. Importing here is the only way to create a
 * harness permit or mutate active config for hermetic tests.
 */

import type { PaxNetworkConfig, NetworkHarnessPermit } from "./paxNetworkConfig.js";
import {
  DEFAULT_PAX_NETWORK_CONFIG,
  registerNetworkHarnessPermit,
  replacePaxNetworkConfigForTests,
  resetPaxNetworkConfigStateForTests
} from "./paxNetworkConfig.js";

/** Create an opaque harness permit bound to this process (WeakSet). */
export function createNetworkHarnessPermit(): NetworkHarnessPermit {
  return registerNetworkHarnessPermit(Object.freeze({ __brand: "PaxNetworkHarnessPermit" as const }));
}

export function setPaxNetworkConfigForTests(config: PaxNetworkConfig): void {
  replacePaxNetworkConfigForTests(config);
}

export function resetPaxNetworkConfigForTests(): void {
  resetPaxNetworkConfigStateForTests();
}

export { DEFAULT_PAX_NETWORK_CONFIG };
