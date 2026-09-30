/**
 * Multi-process worker for GameProcessLock cross-process tests.
 * Config path: argv[2] → JSON file (avoids shell escaping).
 * IPC: process.send / parent messages.
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { InstancePaths } from "../../src/instance/layout/index.js";
import { InstanceLock } from "../../src/instance/lock/index.js";
import {
  GameProcessLock,
  isPidAlive,
  type GameProcessLockLease
} from "../../src/launch/process/lock.js";
import { ErrorCode, LauncherError } from "../../src/core/errors/index.js";
import { releaseGameProcessLockCoordinated } from "../../src/application/play/gameLockCleanup.js";

type Role = "release-hold" | "force-take" | "release-after-b";

interface WorkerConfig {
  role: Role;
  instancePath: string;
  syncDir: string;
}

function send(msg: Record<string, unknown>): void {
  if (process.send) process.send(msg);
}

function deadPid(): number {
  for (let p = 47_000_000; p < 47_000_200; p++) {
    if (!isPidAlive(p)) return p;
  }
  throw new Error("no dead pid");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function waitContinue(): Promise<void> {
  return new Promise((resolve) => {
    const onMsg = (msg: { type?: string }) => {
      if (msg?.type === "continue") {
        process.off("message", onMsg);
        resolve();
      }
    };
    process.on("message", onMsg);
  });
}

async function waitFile(file: string, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await readFile(file);
      return;
    } catch {
      await sleep(20);
    }
  }
  throw new Error(`timeout waiting for ${path.basename(file)}`);
}

/** InstanceLock refuses immediately when LIVE — retry until free or timeout. */
async function acquireInstanceLockRetry(
  lock: InstanceLock,
  operation: string,
  owner: string,
  attempts = 120,
  delayMs = 50
) {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await lock.acquire(operation, { owner });
    } catch (e) {
      last = e;
      const locked =
        LauncherError.isLauncherError(e) && e.code === ErrorCode.INSTANCE_LOCKED;
      if (!locked) throw e;
      await sleep(delayMs);
    }
  }
  throw last instanceof Error ? last : new Error("InstanceLock acquire retry exhausted");
}

async function main(): Promise<void> {
  const cfgPath = process.argv[2];
  if (!cfgPath) throw new Error("missing config path");
  const cfg = JSON.parse(await readFile(cfgPath, "utf8")) as WorkerConfig;
  await mkdir(cfg.syncDir, { recursive: true });
  await mkdir(path.join(cfg.instancePath, "launcher"), { recursive: true });
  const paths = new InstancePaths(cfg.instancePath);
  const gameLock = new GameProcessLock(paths);
  const instanceLock = new InstanceLock(paths);

  try {
    if (cfg.role === "release-hold") {
      const iLease = await instanceLock.acquire("seed-a", { owner: "worker-a-seed" });
      const leaseA = await gameLock.acquire("play-a", { owner: "worker-a" });
      await gameLock.bindGamePid(leaseA, deadPid());
      await instanceLock.releaseLease(iLease);
      await writeFile(path.join(cfg.syncDir, "lease-a.json"), JSON.stringify(leaseA), "utf8");
      send({ type: "ready", leaseId: leaseA.leaseId });

      const outcome = await releaseGameProcessLockCoordinated({
        paths,
        gameLease: leaseA,
        operationId: "worker-a",
        retry: { attempts: 80, delayMs: 25 },
        afterOwnershipVerifiedUnderInstanceLock: async () => {
          send({ type: "holding" });
          await waitContinue();
        }
      });
      send({ type: "done", outcome, leaseId: leaseA.leaseId });
      return;
    }

    if (cfg.role === "force-take") {
      await waitFile(path.join(cfg.syncDir, "lease-a.json"));
      const iLease = await acquireInstanceLockRetry(instanceLock, "play-b", "worker-b");
      const leaseB = await gameLock.acquire("play-b", {
        forceStale: true,
        owner: "worker-b"
      });
      await instanceLock.releaseLease(iLease);
      await writeFile(path.join(cfg.syncDir, "lease-b.json"), JSON.stringify(leaseB), "utf8");
      // Stay alive until parent inspects: ACTIVE requires live launcherPid when gamePid is null.
      send({ type: "done", leaseId: leaseB.leaseId });
      await waitContinue();
      return;
    }

    if (cfg.role === "release-after-b") {
      const iLease = await instanceLock.acquire("seed-a", { owner: "worker-a-seed" });
      const leaseA = await gameLock.acquire("play-a", { owner: "worker-a" });
      await gameLock.bindGamePid(leaseA, deadPid());
      await instanceLock.releaseLease(iLease);
      await writeFile(path.join(cfg.syncDir, "lease-a.json"), JSON.stringify(leaseA), "utf8");
      send({ type: "ready", leaseId: leaseA.leaseId });
      await waitFile(path.join(cfg.syncDir, "lease-b.json"));
      const outcome = await releaseGameProcessLockCoordinated({
        paths,
        gameLease: leaseA as GameProcessLockLease,
        operationId: "worker-a-late",
        retry: { attempts: 40, delayMs: 25 }
      });
      const finalInspect = await gameLock.inspectDetailed();
      send({
        type: "done",
        outcome,
        finalStatus: finalInspect.status,
        finalLeaseId:
          finalInspect.status === "ACTIVE" || finalInspect.status === "STALE"
            ? finalInspect.lock.leaseId
            : null
      });
      return;
    }

    throw new Error(`unknown role ${String(cfg.role)}`);
  } catch (e) {
    send({
      type: "error",
      message: e instanceof Error ? e.message : String(e)
    });
    process.exitCode = 1;
  }
}

void main();
