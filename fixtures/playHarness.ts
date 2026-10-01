import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  FakeClock,
  createFixtureOAuthConfig,
  InMemoryAccountRegistry,
  InMemoryAuthTokenStore,
  MemorySecureRefreshTokenStore,
  MockAuthHttpTransport,
  SecureBackedAuthTokenStore,
  accountIdFromMinecraftUuid,
  type AuthPipelineDeps
} from "../src/auth/index.js";
import type { MapTrustedKeyStore } from "../src/core/trust/index.js";
import { MockHttpClient } from "../src/distribution/http/index.js";
import { MockByteSource } from "../src/download/engine/sources.js";
import { MockMinecraftProcessRunner } from "../src/launch/index.js";
import { ProgressEmitter } from "../src/instance/events/index.js";
import type { PlayDependencies } from "../src/application/play/types.js";
import { PlaySessionCache } from "../src/application/play/types.js";
import {
  ORCH_BASE,
  buildOrchArtefacts,
  mountOrchBundle,
  createOrchDeps,
  testNetworkPolicy
} from "./orchestratorHarness.js";
import {
  FAKE_MS_REFRESH,
  FAKE_PROFILE_ID_HYPHEN,
  FAKE_USERNAME,
  installHappyAuthRoutes,
  profileBody,
  msTokenBody
} from "./auth/fixtures.js";
import { MC_PROFILE_URL } from "../src/auth/minecraft/services.js";
import { DEFAULT_MS_TOKEN_ENDPOINT } from "../src/auth/config.js";
import { buildMinimalFixtures, mockRuntimeSources } from "./minecraft/fixtures.js";
import { windowsX64Platform } from "../src/platform/index.js";
import type { DiscoveredJava } from "../src/java/requirements/index.js";

export { ORCH_BASE, FAKE_PROFILE_ID_HYPHEN, FAKE_USERNAME, testNetworkPolicy };

export function playAccountIdA(): string {
  return accountIdFromMinecraftUuid(FAKE_PROFILE_ID_HYPHEN);
}

export function playAccountIdB(): string {
  return accountIdFromMinecraftUuid("ffeeddcc-bbaa-9988-7766-554433221100");
}

export async function createPlayTestEnv(root: string) {
  const instancePath = path.join(root, "instance");
  const dataDir = path.join(root, "data");
  const runtimePath = path.join(root, "runtime");
  await mkdir(dataDir, { recursive: true });
  await mkdir(runtimePath, { recursive: true });
  return { root, instancePath, dataDir, runtimePath };
}

export async function buildPlayDeps(opts: {
  dataDir: string;
  http: MockHttpClient;
  source: MockByteSource;
  trust: MapTrustedKeyStore;
  runner?: MockMinecraftProcessRunner;
  profileId?: string;
}): Promise<{
  deps: PlayDependencies;
  accounts: InMemoryAccountRegistry;
  secure: MemorySecureRefreshTokenStore;
  transport: MockAuthHttpTransport;
  runner: MockMinecraftProcessRunner;
  clock: FakeClock;
  accountId: string;
}> {
  const orch = await createOrchDeps({
    dataDir: opts.dataDir,
    http: opts.http,
    source: opts.source,
    trust: opts.trust
  });
  const accounts = new InMemoryAccountRegistry();
  const secure = new MemorySecureRefreshTokenStore();
  const store = new SecureBackedAuthTokenStore(secure);
  const transport = new MockAuthHttpTransport();
  installHappyAuthRoutes(transport);
  transport.set("POST", DEFAULT_MS_TOKEN_ENDPOINT, msTokenBody());
  if (opts.profileId) {
    transport.set("GET", MC_PROFILE_URL, profileBody(opts.profileId));
  }
  const clock = new FakeClock(1_000_000);
  const auth: AuthPipelineDeps = {
    config: createFixtureOAuthConfig(),
    transport,
    clock,
    store,
    accounts
  };
  const fx = buildMinimalFixtures();
  const runner = opts.runner ?? new MockMinecraftProcessRunner();
  const javaPath = path.join(opts.dataDir, "java.exe");
  await mkdir(opts.dataDir, { recursive: true });
  await writeFile(javaPath, "fake-java");
  const java: DiscoveredJava = {
    javaPath,
    majorVersion: 21,
    versionString: "21.0.0",
    source: "known_path"
  };
  const accountId = playAccountIdA();
  const deps: PlayDependencies = {
    http: opts.http,
    trust: opts.trust,
    antiRollbackStore: orch.antiRollbackStore,
    antiRollbackState: orch.antiRollbackState,
    artefactSource: opts.source,
    runtimeSources: mockRuntimeSources(fx),
    platform: windowsX64Platform(),
    emitter: new ProgressEmitter(),
    auth,
    accounts,
    sessionCache: new PlaySessionCache(),
    runner,
    java,
    requireClasspathFiles: false,
    allowIncompleteRuntime: true,
    networkHarness: orch.networkHarness,
    networkRuntime: orch.networkRuntime ?? { kind: "test-harness" }
  };
  return { deps, accounts, secure, transport, runner, clock, accountId };
}

export async function seedAccountA(
  accounts: InMemoryAccountRegistry,
  secure: MemorySecureRefreshTokenStore,
  opts?: { lastUsedAtMs?: number }
): Promise<string> {
  const accountId = playAccountIdA();
  accounts.upsert({
    accountId,
    minecraftUuid: FAKE_PROFILE_ID_HYPHEN,
    minecraftUsername: FAKE_USERNAME,
    lastUsedAtMs: opts?.lastUsedAtMs ?? 0
  });
  await secure.save(accountId, FAKE_MS_REFRESH);
  return accountId;
}

export { buildOrchArtefacts, mountOrchBundle, createOrchDeps, InMemoryAuthTokenStore };
