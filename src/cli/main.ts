#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LAUNCHER_VERSION, PRODUCT_NAME } from "../version.js";
import { FetchHttpClient } from "../distribution/http/index.js";
import { DEFAULT_PRODUCT_BASE } from "../distribution/urls/index.js";
import { loadTrustedKeyStoreFromFile } from "../core/trust/index.js";
import { resolveLatestRelease } from "../core/resolve/index.js";
import { FileAntiRollbackStore } from "../instance/state/index.js";
import {
  antiRollbackStatePath,
  defaultLauncherDataDir,
  defaultInstanceRoot,
  defaultRuntimeRoot
} from "../instance/paths/index.js";
import { FetchByteSource } from "../download/engine/sources.js";
import {
  inspectInstanceStatus,
  installInstance,
  updateInstance,
  repairInstance,
  formatStatusHuman,
  formatOperationHuman,
  statusToJson,
  operationToJson,
  startGame,
  runningGameToJson,
  playResultToJson,
  formatPlayHuman,
  type OrchestratorDependencies,
  type PlayDependencies,
  PlaySessionCache
} from "../application/index.js";
import { ProgressEmitter } from "../instance/events/index.js";
import { ErrorCode, LauncherError } from "../core/errors/index.js";
import type { ReleaseChannelName } from "../core/channel/index.js";
import { InstancePaths } from "../instance/layout/index.js";
import { buildInstallationPlan, formatPlanSummaryHuman } from "../instance/plan/index.js";
import { InstanceStateStore } from "../instance/state/instanceState.js";
import { auditInstance, planRepair } from "../instance/audit/index.js";
import { RuntimePaths } from "../minecraft/runtime/paths.js";
import { buildRuntimeInstallationPlan, type RuntimeMetadataSources } from "../minecraft/runtime/plan.js";
import { auditRuntime, planRuntimeRepair } from "../minecraft/audit/index.js";
import {
  DEFAULT_FABRIC_META_BASE,
  DEFAULT_VERSION_MANIFEST_URL
} from "../minecraft/metadata/types.js";
import {
  DEFAULT_MINECRAFT_JSON_MAX_BYTES,
  type FetchedMetadata
} from "../minecraft/metadata/bytes.js";
import { detectPlatform } from "../platform/index.js";
import { discoverJava, pickCompatibleJava } from "../java/discovery/index.js";
import { prepareLaunch, createTestLaunchIdentity, NodeMinecraftProcessRunner } from "../launch/index.js";
import {
  createFixtureOAuthConfig,
  createMicrosoftOAuthConfig,
  createMicrosoftAuthorizationFlow,
  SystemClock,
  DEFAULT_MS_AUTHORIZATION_ENDPOINT,
  DEFAULT_MS_TOKEN_ENDPOINT,
  DEFAULT_LOOPBACK_REDIRECT_URI,
  DEFAULT_MS_OAUTH_SCOPES,
  DEFAULT_MS_AUTHORITY,
  FIXTURE_MS_CLIENT_ID,
  PRODUCT_MICROSOFT_CLIENT_ID,
  resolveLauncherAuthConfig,
  assertLiveAuthEnabled,
  signInInteractively,
  DefaultSystemBrowser,
  createPlatformSecureRefreshTokenStore,
  SecureBackedAuthTokenStore,
  FileAccountRegistry,
  logoutAccount,
  FetchAuthHttpTransport,
  createOAuthConfigFromLauncherAuth,
  formatSafeAuthDiagnostic
} from "../auth/index.js";
import { formatPlayCliDiagnosticLine } from "./play-cli-diagnostics.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

function printHelp(): void {
  console.log(`SweetCraft Launcher CLI (dev)

Usage:
  pnpm launcher:version
  pnpm launcher:status|install|update|repair -- --channel <dev|beta|stable> [--instance <path>] [--json]
  pnpm launcher:play -- --channel <dev|beta|stable> [--instance <path>] [--account <id>] [--memory <MiB>] [--wait] [--json]
  pnpm launcher:resolve -- --help
  pnpm launcher:instance-plan|instance-audit|instance-repair -- --help
  pnpm launcher:runtime-plan|runtime-audit|runtime-repair -- --help
  pnpm launcher:java-discover -- --help
  pnpm launcher:launch-plan -- --help
  pnpm launcher:auth-info -- --help
  pnpm launcher:auth-url -- --help
  pnpm launcher:auth-login -- --help
  pnpm launcher:auth-status -- --help
  pnpm launcher:auth-logout -- --help

Notes:
  --instance / --instance-root optional (default: SweetCraft instances/sweetcraft under data dir).
  --runtime-root optional for install/update/repair/play (default: runtime under data dir).
  --data-dir optional for auth commands (default: %APPDATA%\\SweetCraft Launcher\\launcher-data on Windows).
  --skip-runtime skips Minecraft/Fabric artefact prep (pack-only).
  PLAY does not auto install/update/repair — fix readiness first.
  CLI play keeps the process alive until game exit (lock/argfile correctness).
  Automated tests must not hit the network.
  Auth live currently: BLOCKED_EXTERNAL_APPID_APPROVAL (does not block install/update/repair).
  Auth CLI never prints codeVerifier / tokens / secrets.
  Live auth requires --live and/or SWEETCRAFT_ALLOW_LIVE_AUTH=1.
`);
}

function printInstanceHelp(cmd: string): void {
  console.log(`SweetCraft Launcher — ${cmd}

Required:
  --instance-root <path>
  --channel <dev|beta|stable>
`);
}

function printRuntimeHelp(cmd: string): void {
  console.log(`SweetCraft Launcher — ${cmd}

Required:
  --runtime-root <path>   Isolated runtime directory (never implicit .minecraft)

Optional:
  --minecraft <version>   default: from --channel resolve, else required
  --fabric-loader <ver>   default: from --channel resolve, else required
  --channel <dev|beta|stable>  resolve versions from trusted SweetCraft release
`);
}

function parseArgs(argv: string[]): { command: string; flags: Record<string, string | boolean> } {
  const [command = "help", ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--help" || a === "-h") {
      flags.help = true;
      continue;
    }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return { command, flags };
}

function requireInstanceRoot(flags: Record<string, string | boolean>): string {
  const root = flags["instance-root"] ?? flags.instance;
  if (typeof root !== "string" || !root.trim()) {
    throw new LauncherError(ErrorCode.INSTANCE_ROOT_REQUIRED, "--instance-root is required");
  }
  return path.resolve(root);
}

function resolveInstancePath(flags: Record<string, string | boolean>): string {
  const root = flags["instance-root"] ?? flags.instance;
  if (typeof root === "string" && root.trim()) {
    return path.resolve(root);
  }
  return defaultInstanceRoot();
}

function resolveRuntimePath(flags: Record<string, string | boolean>): string {
  const root = flags["runtime-root"];
  if (typeof root === "string" && root.trim()) {
    return path.resolve(root);
  }
  return defaultRuntimeRoot();
}

async function buildOrchestratorDeps(
  flags: Record<string, string | boolean>
): Promise<{
  deps: OrchestratorDependencies;
  channel: ReleaseChannelName;
  productBase: string;
}> {
  const channel = String(flags.channel ?? "");
  if (channel !== "dev" && channel !== "beta" && channel !== "stable") {
    throw new LauncherError(ErrorCode.INVALID_CHANNEL, "--channel is required (dev|beta|stable)");
  }
  const productBase = typeof flags.origin === "string" ? flags.origin : DEFAULT_PRODUCT_BASE;
  const trustedKeysPath =
    typeof flags["trusted-keys"] === "string"
      ? flags["trusted-keys"]
      : path.join(ROOT, "config", "trusted-keys.json");
  const trust = loadTrustedKeyStoreFromFile(trustedKeysPath);
  const antiRollbackStore = new FileAntiRollbackStore(antiRollbackStatePath(defaultLauncherDataDir()));
  const antiRollbackState = await antiRollbackStore.load();
  const http = new FetchHttpClient();
  const skipRuntime = flags["skip-runtime"] === true;
  const deps: OrchestratorDependencies = {
    http,
    trust,
    artefactSource: new FetchByteSource(),
    antiRollbackStore,
    antiRollbackState,
    emitter: new ProgressEmitter()
  };
  if (!skipRuntime) {
    deps.runtimeSources = liveRuntimeSources();
    deps.runtimeByteSource = new FetchByteSource();
  }
  return { deps, channel: channel as ReleaseChannelName, productBase };
}

function printOrchestratorHelp(cmd: string): void {
  console.log(`SweetCraft Launcher — ${cmd}

Options:
  --channel <dev|beta|stable>   required
  --instance <path>             optional (default SweetCraft instance)
  --runtime-root <path>         optional (install/update/repair)
  --origin <url>                optional product base
  --trusted-keys <path>         optional trusted public key store override
  --skip-runtime                pack-only (no Mojang/Fabric downloads)
  --json                        machine-readable output
  --force-stale-lock            clear dead lock (operator only)
`);
}

async function cmdStatus(flags: Record<string, string | boolean>): Promise<void> {
  if (flags.help) {
    printOrchestratorHelp("status");
    return;
  }
  try {
    const { deps, channel, productBase } = await buildOrchestratorDeps(flags);
    const report = await inspectInstanceStatus(
      {
        channel,
        instancePath: resolveInstancePath(flags),
        productBase
      },
      deps
    );
    if (flags.json) {
      console.log(JSON.stringify(statusToJson(report), null, 2));
    } else {
      console.log(formatStatusHuman(report));
    }
  } catch (e) {
    printErr(e);
  }
}

async function cmdInstall(flags: Record<string, string | boolean>): Promise<void> {
  if (flags.help) {
    printOrchestratorHelp("install");
    return;
  }
  try {
    const { deps, channel, productBase } = await buildOrchestratorDeps(flags);
    if (!flags.json) {
      console.log(`Resolving SweetCraft ${channel}...`);
      console.log("Planning installation...");
    }
    const result = await installInstance(
      {
        operation: "install",
        channel,
        instancePath: resolveInstancePath(flags),
        runtimePath: resolveRuntimePath(flags),
        productBase,
        skipRuntimePrep: flags["skip-runtime"] === true,
        forceStaleLock: flags["force-stale-lock"] === true
      },
      deps
    );
    if (flags.json) {
      console.log(JSON.stringify(operationToJson(result), null, 2));
    } else {
      console.log("Verifying...");
      console.log(formatOperationHuman(result));
    }
  } catch (e) {
    printErr(e);
  }
}

async function cmdUpdate(flags: Record<string, string | boolean>): Promise<void> {
  if (flags.help) {
    printOrchestratorHelp("update");
    return;
  }
  try {
    const { deps, channel, productBase } = await buildOrchestratorDeps(flags);
    if (!flags.json) console.log(`Updating SweetCraft ${channel}...`);
    const result = await updateInstance(
      {
        operation: "update",
        channel,
        instancePath: resolveInstancePath(flags),
        runtimePath: resolveRuntimePath(flags),
        productBase,
        skipRuntimePrep: flags["skip-runtime"] === true,
        forceStaleLock: flags["force-stale-lock"] === true
      },
      deps
    );
    if (flags.json) {
      console.log(JSON.stringify(operationToJson(result), null, 2));
    } else {
      console.log(formatOperationHuman(result));
    }
  } catch (e) {
    printErr(e);
  }
}

async function cmdRepair(flags: Record<string, string | boolean>): Promise<void> {
  if (flags.help) {
    printOrchestratorHelp("repair");
    return;
  }
  try {
    const { deps, channel, productBase } = await buildOrchestratorDeps(flags);
    if (!flags.json) console.log(`Repairing SweetCraft ${channel}...`);
    const result = await repairInstance(
      {
        operation: "repair",
        channel,
        instancePath: resolveInstancePath(flags),
        runtimePath: resolveRuntimePath(flags),
        productBase,
        skipRuntimePrep: flags["skip-runtime"] === true,
        forceStaleLock: flags["force-stale-lock"] === true
      },
      deps
    );
    if (flags.json) {
      console.log(JSON.stringify(operationToJson(result), null, 2));
    } else {
      console.log(formatOperationHuman(result));
    }
  } catch (e) {
    printErr(e);
  }
}

async function cmdPlay(flags: Record<string, string | boolean>): Promise<void> {
  if (flags.help) {
    console.log(`SweetCraft Launcher — play

Options:
  --channel <dev|beta|stable>   required
  --instance <path>             optional
  --runtime-root <path>         optional
  --trusted-keys <path>         optional trusted public key store override
  --account <accountId>         optional (else lastUsed / single account)
  --memory <MiB>                max heap (default 2048)
  --wait                        wait for game exit (default: always wait — lock safety)
  --json                        machine-readable output

PLAY never auto-installs/updates/repairs.
CLI remains alive until Minecraft exits (GameProcessLock + argfile cleanup).
Does not open interactive login browser.
Uses the embedded product Microsoft public client id (override via SWEETCRAFT_MICROSOFT_CLIENT_ID).
`);
    return;
  }
  try {
    const { deps: orchDeps, channel, productBase } = await buildOrchestratorDeps(flags);
    const dataDir = defaultLauncherDataDir();
    const accounts = new FileAccountRegistry(dataDir);
    const secure = createPlatformSecureRefreshTokenStore(dataDir);
    const store = new SecureBackedAuthTokenStore(secure);
    const clock = new SystemClock();
    const emitter = orchDeps.emitter ?? new ProgressEmitter();
    if (!flags.json) {
      // Human diagnostic: PLAY_PROGRESS + sanitized GAME_STDOUT/GAME_STDERR only.
      // Sanitization authority = NodeMinecraftProcessRunner (do not re-sanitize here).
      emitter.on((e) => {
        const line = formatPlayCliDiagnosticLine(e);
        if (line !== null) console.log(line);
      });
    }

    const launcherAuth = resolveLauncherAuthConfig();
    const config = createOAuthConfigFromLauncherAuth(
      launcherAuth,
      "http://localhost/play-unused/"
    );

    const playDeps: PlayDependencies = {
      http: orchDeps.http,
      trust: orchDeps.trust,
      antiRollbackStore: orchDeps.antiRollbackStore,
      antiRollbackState: orchDeps.antiRollbackState,
      artefactSource: orchDeps.artefactSource,
      ...(orchDeps.runtimeSources ? { runtimeSources: orchDeps.runtimeSources } : {}),
      ...(orchDeps.runtimeByteSource ? { runtimeByteSource: orchDeps.runtimeByteSource } : {}),
      emitter,
      auth: {
        config,
        transport: new FetchAuthHttpTransport(),
        clock,
        store,
        accounts
      },
      accounts,
      sessionCache: new PlaySessionCache(),
      runner: new NodeMinecraftProcessRunner()
    };

    const memory =
      typeof flags.memory === "string" && flags.memory.trim()
        ? Number(flags.memory)
        : undefined;

    const game = await startGame(
      {
        channel,
        instancePath: resolveInstancePath(flags),
        runtimePath: resolveRuntimePath(flags),
        productBase,
        ...(typeof flags.account === "string" ? { accountId: flags.account } : {}),
        ...(memory !== undefined && Number.isFinite(memory) ? { memoryMiB: memory } : {})
      },
      playDeps
    );

    if (flags.json) {
      console.log(JSON.stringify(runningGameToJson(game), null, 2));
    } else {
      console.log(
        formatPlayHuman({
          operationId: game.operationId,
          accountId: game.accountId,
          minecraftUsername: game.minecraftUsername,
          minecraftUuid: game.minecraftUuid,
          packVersion: game.packVersion,
          releaseSequence: game.releaseSequence,
          gamePid: game.gamePid,
          outcome: "STARTED"
        })
      );
    }

    // Always wait — detaching would risk orphaning GameProcessLock / argfile ownership.
    const exit = await game.completion;
    const exited = {
      operationId: game.operationId,
      accountId: game.accountId,
      minecraftUsername: game.minecraftUsername,
      minecraftUuid: game.minecraftUuid,
      packVersion: game.packVersion,
      releaseSequence: game.releaseSequence,
      gamePid: game.gamePid,
      outcome: "EXITED" as const,
      exitCode: exit.exitCode,
      signal: exit.signal,
      durationMs: exit.durationMs
    };
    if (flags.json) {
      console.log(JSON.stringify(playResultToJson(exited), null, 2));
    } else {
      console.log(formatPlayHuman(exited));
    }
    if (exit.exitCode !== 0 && exit.exitCode !== null) {
      process.exitCode = exit.exitCode;
    }
  } catch (e) {
    printErr(e);
  }
}

function requireRuntimeRoot(flags: Record<string, string | boolean>): string {
  const root = flags["runtime-root"];
  if (typeof root !== "string" || !root.trim()) {
    throw new LauncherError(ErrorCode.RUNTIME_ROOT_REQUIRED, "--runtime-root is required");
  }
  return path.resolve(root);
}

async function resolveForCli(flags: Record<string, string | boolean>) {
  const channel = String(flags.channel ?? "");
  if (channel !== "dev" && channel !== "beta" && channel !== "stable") {
    throw new LauncherError(ErrorCode.INVALID_CHANNEL, "--channel is required (dev|beta|stable)");
  }
  const origin = typeof flags.origin === "string" ? flags.origin : DEFAULT_PRODUCT_BASE;
  const trustedKeysPath =
    typeof flags["trusted-keys"] === "string"
      ? flags["trusted-keys"]
      : path.join(ROOT, "config", "trusted-keys.json");
  const trust = loadTrustedKeyStoreFromFile(trustedKeysPath);
  const store = new FileAntiRollbackStore(antiRollbackStatePath(defaultLauncherDataDir()));
  const antiRollbackState = await store.load();
  const http = new FetchHttpClient();
  return resolveLatestRelease({
    channel: channel as ReleaseChannelName,
    productBase: origin,
    http,
    trust,
    antiRollbackState
  });
}

function liveRuntimeSources(): RuntimeMetadataSources {
  const http = new FetchHttpClient();
  const getBytes = async (url: string): Promise<FetchedMetadata> => {
    const res = await http.request({ url, maxBytes: DEFAULT_MINECRAFT_JSON_MAX_BYTES });
    const out: FetchedMetadata = {
      bytes: new Uint8Array(res.body),
      url: res.finalUrl
    };
    if (res.headers["content-type"]) out.contentType = res.headers["content-type"];
    return out;
  };
  return {
    fetchVersionManifest: () => getBytes(DEFAULT_VERSION_MANIFEST_URL),
    fetchVersionMeta: (url) => getBytes(url),
    fetchAssetIndex: (url) => getBytes(url),
    fetchFabricLoaderList: (mc) =>
      getBytes(`${DEFAULT_FABRIC_META_BASE}/v2/versions/loader/${encodeURIComponent(mc)}`),
    fetchFabricProfile: (mc, loader) =>
      getBytes(
        `${DEFAULT_FABRIC_META_BASE}/v2/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(loader)}/profile/json`
      ),
    fetchUrlBytes: (url) => getBytes(url)
  };
}

async function resolveMcFabricVersions(flags: Record<string, string | boolean>): Promise<{
  minecraftVersion: string;
  fabricLoaderVersion: string;
}> {
  if (typeof flags.minecraft === "string" && typeof flags["fabric-loader"] === "string") {
    return { minecraftVersion: flags.minecraft, fabricLoaderVersion: flags["fabric-loader"] };
  }
  if (flags.channel) {
    const resolved = await resolveForCli(flags);
    return {
      minecraftVersion: resolved.clientManifest.minecraft,
      fabricLoaderVersion: resolved.clientManifest.fabricLoader
    };
  }
  throw new LauncherError(
    ErrorCode.INVALID_MINECRAFT_METADATA,
    "provide --minecraft and --fabric-loader, or --channel to resolve from SweetCraft"
  );
}

async function cmdResolve(flags: Record<string, string | boolean>): Promise<void> {
  if (flags.help) {
    printHelp();
    return;
  }
  try {
    const resolved = await resolveForCli(flags);
    console.log(
      JSON.stringify(
        {
          trusted: true,
          channel: resolved.channel.descriptor.channel,
          packVersion: resolved.release.release.packVersion,
          minecraft: resolved.clientManifest.minecraft,
          fabricLoader: resolved.clientManifest.fabricLoader
        },
        null,
        2
      )
    );
  } catch (e) {
    printErr(e);
  }
}

async function cmdInstancePlan(flags: Record<string, string | boolean>): Promise<void> {
  if (flags.help) {
    printInstanceHelp("instance-plan");
    return;
  }
  try {
    const instanceRoot = requireInstanceRoot(flags);
    const paths = new InstancePaths(instanceRoot);
    const resolved = await resolveForCli(flags);
    const state = await new InstanceStateStore(paths).load();
    const plan = await buildInstallationPlan({ resolved, state, paths, dryRun: true });
    console.log(JSON.stringify({ summary: plan.summary }, null, 2));
    console.log(formatPlanSummaryHuman(plan.summary));
  } catch (e) {
    printErr(e);
  }
}

async function cmdInstanceAudit(flags: Record<string, string | boolean>): Promise<void> {
  if (flags.help) {
    printInstanceHelp("instance-audit");
    return;
  }
  try {
    const paths = new InstancePaths(requireInstanceRoot(flags));
    const resolved = await resolveForCli(flags);
    const report = await auditInstance({ resolved, paths });
    console.log(JSON.stringify(report.findings, null, 2));
  } catch (e) {
    printErr(e);
  }
}

async function cmdInstanceRepair(flags: Record<string, string | boolean>): Promise<void> {
  if (flags.help) {
    printInstanceHelp("instance-repair");
    return;
  }
  try {
    const paths = new InstancePaths(requireInstanceRoot(flags));
    const resolved = await resolveForCli(flags);
    const plan = await planRepair({ resolved, paths });
    console.log(JSON.stringify({ summary: plan.summary }, null, 2));
  } catch (e) {
    printErr(e);
  }
}

async function cmdRuntimePlan(flags: Record<string, string | boolean>): Promise<void> {
  if (flags.help) {
    printRuntimeHelp("runtime-plan");
    return;
  }
  try {
    const runtimeRoot = requireRuntimeRoot(flags);
    const vers = await resolveMcFabricVersions(flags);
    const plan = await buildRuntimeInstallationPlan({
      ...vers,
      platform: detectPlatform(),
      paths: new RuntimePaths(runtimeRoot),
      sources: liveRuntimeSources(),
      dryRun: true
    });
    console.log(
      JSON.stringify(
        {
          minecraftVersion: plan.minecraftVersion,
          fabricLoaderVersion: plan.fabricLoaderVersion,
          mainClass: plan.mainClass,
          javaRequirement: plan.javaRequirement,
          summary: plan.summary
        },
        null,
        2
      )
    );
  } catch (e) {
    printErr(e);
  }
}

async function cmdRuntimeAudit(flags: Record<string, string | boolean>): Promise<void> {
  if (flags.help) {
    printRuntimeHelp("runtime-audit");
    return;
  }
  try {
    const runtimeRoot = requireRuntimeRoot(flags);
    const vers = await resolveMcFabricVersions(flags);
    const java = await discoverJava({});
    const report = await auditRuntime({
      ...vers,
      platform: detectPlatform(),
      paths: new RuntimePaths(runtimeRoot),
      sources: liveRuntimeSources(),
      discoveredJava: java
    });
    console.log(JSON.stringify(report.findings, null, 2));
  } catch (e) {
    printErr(e);
  }
}

async function cmdRuntimeRepair(flags: Record<string, string | boolean>): Promise<void> {
  if (flags.help) {
    printRuntimeHelp("runtime-repair");
    return;
  }
  try {
    const runtimeRoot = requireRuntimeRoot(flags);
    const vers = await resolveMcFabricVersions(flags);
    const plan = await planRuntimeRepair({
      ...vers,
      platform: detectPlatform(),
      paths: new RuntimePaths(runtimeRoot),
      sources: liveRuntimeSources()
    });
    console.log(JSON.stringify({ summary: plan.summary }, null, 2));
  } catch (e) {
    printErr(e);
  }
}

async function cmdJavaDiscover(flags: Record<string, string | boolean>): Promise<void> {
  if (flags.help) {
    console.log(`SweetCraft Launcher — java-discover

Optional:
  --managed-java <path-to-java-binary>
`);
    return;
  }
  try {
    const managed =
      typeof flags["managed-java"] === "string" ? flags["managed-java"] : undefined;
    const found = await discoverJava({
      ...(managed ? { managedJavaPath: managed } : {})
    });
    console.log(JSON.stringify({ platform: detectPlatform(), java: found }, null, 2));
  } catch (e) {
    printErr(e);
  }
}

function printLaunchPlanHelp(): void {
  console.log(`SweetCraft Launcher — launch-plan (dry-run)

Required:
  --runtime-root <path>
  --instance-root <path>

Versions:
  --minecraft <version> + --fabric-loader <ver>
  OR --channel <dev|beta|stable>

Optional:
  --max-memory-mib <n>   default 2048
  --min-memory-mib <n>
  --java <path>          explicit java.exe (else discover)
  --test-identity        use built-in test identity (default for this CLI)

Outputs a SANITIZED LaunchSpec summary. Never prints accessToken.
Does NOT spawn Minecraft.
`);
}

async function cmdLaunchPlan(flags: Record<string, string | boolean>): Promise<void> {
  if (flags.help) {
    printLaunchPlanHelp();
    return;
  }
  try {
    const runtimeRoot = requireRuntimeRoot(flags);
    const instanceRoot = requireInstanceRoot(flags);
    const vers = await resolveMcFabricVersions(flags);
    const platform = detectPlatform();
    const paths = new RuntimePaths(runtimeRoot);
    const plan = await buildRuntimeInstallationPlan({
      ...vers,
      platform,
      paths,
      sources: liveRuntimeSources(),
      dryRun: true
    });

    const javaList =
      typeof flags.java === "string"
        ? await discoverJava({ extraCandidates: [flags.java] })
        : await discoverJava();
    const java = plan.javaRequirement
      ? pickCompatibleJava(javaList, plan.javaRequirement)
      : javaList[0];
    if (!java) {
      throw new LauncherError(ErrorCode.MISSING_JAVA, "no Java found for launch-plan");
    }

    const maxMemoryMiB =
      typeof flags["max-memory-mib"] === "string" ? Number(flags["max-memory-mib"]) : 2048;
    const minMemoryMiB =
      typeof flags["min-memory-mib"] === "string" ? Number(flags["min-memory-mib"]) : undefined;

    const identity = createTestLaunchIdentity();
    const prepared = await prepareLaunch({
      runtime: plan.resolved,
      paths,
      instanceRoot,
      platform,
      java,
      identity,
      memory: {
        maxMemoryMiB,
        ...(minMemoryMiB !== undefined ? { minMemoryMiB } : {})
      },
      runtimeFindings: plan.entries
        .filter((e) => e.action !== "EXTRACT_NATIVE" && e.action !== "WRITE_METADATA")
        .map((e) => ({
          status: e.action === "KEEP" ? ("OK" as const) : e.action === "REPAIR" ? ("CORRUPT" as const) : ("MISSING" as const),
          id: e.id,
          relativePath: e.relativePath
        })),
      allowNotReady: true,
      requireClasspathFiles: false
    });

    console.log(
      JSON.stringify(
        {
          dryRun: true,
          readiness: prepared.readiness,
          sanitized: prepared.sanitizedSummary
        },
        null,
        2
      )
    );
  } catch (e) {
    printErr(e);
  }
}

async function cmdAuthInfo(flags: Record<string, string | boolean>): Promise<void> {
  if (flags.help) {
    console.log(`SweetCraft Launcher — auth-info

Prints non-secret OAuth / auth architecture summary.
Never prints tokens, codeVerifier, or client_secret (none exists).
`);
    return;
  }
  console.log(
    JSON.stringify(
      {
        version: LAUNCHER_VERSION,
        model: "public_client_authorization_code_pkce_s256",
        clientSecret: null,
        productMicrosoftClientId: PRODUCT_MICROSOFT_CLIENT_ID,
        endpoints: {
          authorization: DEFAULT_MS_AUTHORIZATION_ENDPOINT,
          token: DEFAULT_MS_TOKEN_ENDPOINT
        },
        authority: DEFAULT_MS_AUTHORITY,
        defaultRedirectUri: DEFAULT_LOOPBACK_REDIRECT_URI,
        liveRedirectStrategy: "http://localhost:{port}/",
        scopes: [...DEFAULT_MS_OAUTH_SCOPES],
        fixtureClientIdForTestsOnly: FIXTURE_MS_CLIENT_ID,
        note: "Product embeds public client id. Override with SWEETCRAFT_MICROSOFT_CLIENT_ID. Never embed client_secret. Live: pnpm launcher:auth-login -- --live"
      },
      null,
      2
    )
  );
}

async function cmdAuthUrl(flags: Record<string, string | boolean>): Promise<void> {
  if (flags.help) {
    console.log(`SweetCraft Launcher — auth-url (DEV)

Generates a PKCE authorization URL for development.
Never prints codeVerifier.

Optional:
  --client-id <uuid>   Microsoft public client id (required for non-fixture)
  --fixture            use fixture client id (tests/dev only)
`);
    return;
  }
  try {
    const useFixture = flags.fixture === true;
    const clientId =
      typeof flags["client-id"] === "string"
        ? flags["client-id"]
        : useFixture
          ? FIXTURE_MS_CLIENT_ID
          : undefined;
    if (!clientId) {
      throw new LauncherError(
        ErrorCode.INVALID_OAUTH_CONFIG,
        "provide --client-id or --fixture (fixture is not a real Microsoft app)"
      );
    }
    const config = useFixture
      ? createFixtureOAuthConfig()
      : createMicrosoftOAuthConfig({ clientId });
    const { flow, authorizationUrl } = createMicrosoftAuthorizationFlow({
      config,
      clock: new SystemClock()
    });
    console.log(
      JSON.stringify(
        {
          authorizationUrl,
          flowId: flow.flowId,
          redirectUri: config.redirectUri,
          expiresAtMs: flow.expiresAtMs,
          note: "codeVerifier retained only in-memory for this process; not printed."
        },
        null,
        2
      )
    );
  } catch (e) {
    printErr(e);
  }
}

async function cmdAuthLogin(flags: Record<string, string | boolean>): Promise<void> {
  if (flags.help) {
    console.log(`SweetCraft Launcher — auth-login (DEV / LIVE)

Interactive Microsoft login via system browser + loopback callback.
Never prints tokens. Never accepts a password.

Required live gate:
  --live
  and/or SWEETCRAFT_ALLOW_LIVE_AUTH=1

Client id (public UUID — not a secret):
  embedded product default
  optional override: SWEETCRAFT_MICROSOFT_CLIENT_ID or --client-id <uuid>

Optional:
  --data-dir <path>   launcher data directory (default: platform AppData)
  --diag              print SAFE diagnostic fields on failure (no secrets)
`);
    return;
  }
  let redirectUriForDiag: string | undefined;
  try {
    assertLiveAuthEnabled({ liveFlag: flags.live === true });
    const clientId = typeof flags["client-id"] === "string" ? flags["client-id"] : undefined;
    const launcherAuth = resolveLauncherAuthConfig({
      ...(clientId ? { clientId } : {})
    });
    const dataDir =
      typeof flags["data-dir"] === "string" ? flags["data-dir"] : defaultLauncherDataDir();
    const secure = createPlatformSecureRefreshTokenStore(dataDir);
    if (
      secure.kind === "windows-dpapi" &&
      "probe" in secure &&
      typeof (secure as { probe?: () => Promise<boolean> }).probe === "function"
    ) {
      await (secure as { probe: () => Promise<boolean> }).probe();
    }
    const store = new SecureBackedAuthTokenStore(secure, {
      persistRefresh: secure.available
    });
    const accounts = new FileAccountRegistry(dataDir);
    const clock = new SystemClock();
    const { session, securePersistence } = await signInInteractively({
      launcherAuth,
      browser: new DefaultSystemBrowser(),
      clock,
      store,
      accounts,
      secureStore: secure,
      persistRefresh: secure.available,
      transport: new FetchAuthHttpTransport()
    });
    console.log("AUTH_LOGIN_OK");
    console.log(`Minecraft username: ${session.profile.name}`);
    console.log(`Minecraft UUID: ${session.launchIdentity.uuid}`);
    console.log(
      `Entitlement: ${session.entitlements.ownsMinecraftJava ? "OK" : "MISSING"}`
    );
    console.log(`Secure persistence: ${securePersistence && secure.available ? "YES" : "NO"}`);
    console.log(`Account id: ${session.accountId}`);
  } catch (e) {
    printAuthLiveErr(e, {
      diag: flags.diag === true,
      ...(redirectUriForDiag ? { redirectUri: redirectUriForDiag } : {})
    });
  }
}

async function cmdAuthStatus(flags: Record<string, string | boolean>): Promise<void> {
  if (flags.help) {
    console.log(`SweetCraft Launcher — auth-status

Shows SIGNED_OUT or account metadata only (never tokens).

Optional:
  --data-dir <path>
  --account <id>
`);
    return;
  }
  try {
    const dataDir =
      typeof flags["data-dir"] === "string" ? flags["data-dir"] : defaultLauncherDataDir();
    const accounts = new FileAccountRegistry(dataDir);
    const list = await accounts.list();
    const accountFlag = typeof flags.account === "string" ? flags.account : undefined;
    const record = accountFlag
      ? await accounts.get(accountFlag)
      : list.sort((a, b) => b.lastUsedAtMs - a.lastUsedAtMs)[0];
    if (!record) {
      console.log("SIGNED_OUT");
      return;
    }
    console.log("SIGNED_IN");
    console.log(`Username: ${record.minecraftUsername}`);
    console.log(`UUID: ${record.minecraftUuid}`);
    console.log(`Account id: ${record.accountId}`);
  } catch (e) {
    printErr(e);
  }
}

async function cmdAuthLogout(flags: Record<string, string | boolean>): Promise<void> {
  if (flags.help) {
    console.log(`SweetCraft Launcher — auth-logout

Deletes local secure refresh credential + account metadata.
Does not claim remote Microsoft revocation.

Required:
  --account <id>

Optional:
  --data-dir <path>
  --live   (optional; logout is local-only and does not need network)
`);
    return;
  }
  try {
    const accountId = typeof flags.account === "string" ? flags.account : undefined;
    if (!accountId) {
      throw new LauncherError(ErrorCode.INVALID_OAUTH_CONFIG, "provide --account <id>", {});
    }
    const dataDir =
      typeof flags["data-dir"] === "string" ? flags["data-dir"] : defaultLauncherDataDir();
    const secure = createPlatformSecureRefreshTokenStore(dataDir);
    const store = new SecureBackedAuthTokenStore(secure, { persistRefresh: secure.available });
    const accounts = new FileAccountRegistry(dataDir);
    // Minimal config for logout (no network) — redirect unused
    const launcherAuth = (() => {
      try {
        return resolveLauncherAuthConfig({
          ...(typeof flags["client-id"] === "string" ? { clientId: flags["client-id"] } : {})
        });
      } catch {
        return {
          microsoftClientId: FIXTURE_MS_CLIENT_ID,
          redirectStrategy: "localhost-dynamic" as const
        };
      }
    })();
    const config = createOAuthConfigFromLauncherAuth(
      launcherAuth,
      "http://localhost/logout-unused/"
    );
    await logoutAccount(
      {
        config,
        transport: new FetchAuthHttpTransport(),
        clock: new SystemClock(),
        store,
        accounts
      },
      accountId
    );
    console.log("AUTH_LOGGED_OUT");
    console.log(`Account id: ${accountId}`);
  } catch (e) {
    printErr(e);
  }
}

function printAuthLiveErr(
  e: unknown,
  opts: { diag?: boolean; redirectUri?: string } = {}
): void {
  if (LauncherError.isLauncherError(e)) {
    const base: Record<string, unknown> = {
      error: e.code
    };
    if (typeof e.details.stage === "string") base.stage = e.details.stage;
    if (typeof e.details.status === "number") base.status = e.details.status;
    if (typeof e.details.oauthErrorCode === "string") base.oauthErrorCode = e.details.oauthErrorCode;
    if (typeof e.details.minecraftReason === "string") {
      base.minecraftReason = e.details.minecraftReason;
    }
    if (opts.diag) {
      console.error(
        JSON.stringify(
          {
            AUTH_STAGE: base.stage,
            ...formatSafeAuthDiagnostic({
              errorCode: e.code,
              ...(typeof base.stage === "string" ? { stage: base.stage } : {}),
              ...(typeof base.status === "number" ? { status: base.status } : {}),
              ...(typeof base.oauthErrorCode === "string"
                ? { oauthErrorCode: base.oauthErrorCode }
                : {}),
              ...(typeof base.minecraftReason === "string"
                ? { minecraftReason: base.minecraftReason }
                : {}),
              ...(opts.redirectUri ? { redirectUri: opts.redirectUri } : {})
            })
          },
          null,
          2
        )
      );
    } else {
      console.error(JSON.stringify(base, null, 2));
    }
  } else {
    console.error(JSON.stringify({ error: ErrorCode.AUTH_SESSION_ERROR }, null, 2));
  }
  process.exitCode = 1;
}

function printErr(e: unknown): void {
  if (LauncherError.isLauncherError(e)) {
    const details = { ...e.details };
    for (const k of Object.keys(details)) {
      if (/token|secret|password|verifier|code|refresh/i.test(k)) details[k] = "<redacted>";
    }
    console.error(JSON.stringify({ error: e.code, message: e.message, details }, null, 2));
  } else {
    console.error(JSON.stringify({ error: ErrorCode.INTERNAL_ERROR }, null, 2));
  }
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (command === "version") {
    console.log(`${PRODUCT_NAME} ${LAUNCHER_VERSION}`);
    return;
  }
  if (command === "help") {
    printHelp();
    return;
  }
  const routes: Record<string, (f: Record<string, string | boolean>) => Promise<void>> = {
    status: cmdStatus,
    install: cmdInstall,
    update: cmdUpdate,
    repair: cmdRepair,
    play: cmdPlay,
    resolve: cmdResolve,
    "instance-plan": cmdInstancePlan,
    "instance-audit": cmdInstanceAudit,
    "instance-repair": cmdInstanceRepair,
    "runtime-plan": cmdRuntimePlan,
    "runtime-audit": cmdRuntimeAudit,
    "runtime-repair": cmdRuntimeRepair,
    "java-discover": cmdJavaDiscover,
    "launch-plan": cmdLaunchPlan,
    "auth-info": cmdAuthInfo,
    "auth-url": cmdAuthUrl,
    "auth-login": cmdAuthLogin,
    "auth-status": cmdAuthStatus,
    "auth-logout": cmdAuthLogout
  };
  const fn = routes[command];
  if (!fn) {
    console.error(`unknown command: ${command}`);
    printHelp();
    process.exitCode = 1;
    return;
  }
  await fn(flags);
}

main().catch(() => {
  console.error(JSON.stringify({ error: ErrorCode.INTERNAL_ERROR }, null, 2));
  process.exitCode = 1;
});
