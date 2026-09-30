/**
 * Aggregates frozen 0.5A ProgressEmitter events into normalized InstallProgressDto.
 * Bridges OPERATION_PROGRESS, DOWNLOAD_*, FILE_*, and PLAN_READY with throttling.
 */

import type { InstallProgressDto, InstallProgressPhase } from "../../shared/contract.js";
import { mapOperationPhase, normalizeInstallProgress } from "./install-progress.js";
import { InstallByteSpeedTracker, computeEtaSeconds } from "./install-progress-speed.js";

export interface EngineProgressEvent {
  readonly type: string;
  readonly timestamp?: string;
  readonly data: Record<string, unknown>;
}

export interface InstallProgressAggregatorOptions {
  readonly fallbackOperation?: InstallProgressDto["operation"];
  readonly minEmitIntervalMs?: number;
  readonly now?: () => number;
  readonly log?: (entry: Record<string, unknown>) => void;
}

export interface InstallProgressAggregatorStats {
  rawEvents: number;
  forwardedEvents: number;
}

interface DownloadTrack {
  bytesReceived: number;
  expectedSize: number;
  done: boolean;
  verifiedSize: number;
}

function basenameSafe(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (!t) return undefined;
  const parts = t.replace(/\\/g, "/").split("/");
  const base = parts[parts.length - 1];
  if (!base || base.length > 128) return undefined;
  if (base.includes(":") || base.includes("\0")) return undefined;
  return base;
}

function logicalIdLabel(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (!t || t.length > 128) return undefined;
  if (t.includes("\\") || t.includes("/") || t.includes(":") || t.includes("\0")) return undefined;
  return t;
}

function nonNegInt(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  if (v < 0 || v > Number.MAX_SAFE_INTEGER) return undefined;
  return Math.floor(v);
}

export function createInstallProgressAggregator(
  onProgress: (dto: InstallProgressDto) => void,
  opts: InstallProgressAggregatorOptions = {},
): {
  handleEvent(event: EngineProgressEvent): void;
  flush(): void;
  reset(): void;
  getStats(): InstallProgressAggregatorStats;
} {
  const fallbackOperation = opts.fallbackOperation ?? "install";
  const minEmitIntervalMs = opts.minEmitIntervalMs ?? 100;
  const now = opts.now ?? (() => Date.now());
  const log = opts.log ?? (() => undefined);

  let operation: InstallProgressDto["operation"] = fallbackOperation;
  let phase: InstallProgressPhase = "PREPARING";
  let operationStartedAt = 0;
  let phaseStartedAt = 0;
  let lastEnginePhase = "";

  let planTotalFiles: number | undefined;
  let planApplyFiles: number | undefined;

  /** Fixed pack download denominator from PLAN_READY — immutable during DOWNLOADING. */
  let packPlannedDownloadBytes: number | undefined;
  let packDownloadBytesKnown = false;
  let packPlannedDownloadFiles = 0;

  /** Fixed runtime download denominator from RUNTIME_PLAN_READY — immutable during PREPARING_RUNTIME. */
  let runtimePlannedDownloadBytes: number | undefined;
  let runtimeDownloadBytesKnown = false;
  let runtimePlannedDownloadFiles = 0;

  const downloads = new Map<string, DownloadTrack>();
  let completedFiles = 0;
  let currentItemLabel: string | undefined;

  const speedTracker = new InstallByteSpeedTracker();

  let rawEvents = 0;
  let forwardedEvents = 0;
  let lastEmitAt = 0;
  let pendingFlush = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function reset(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    operation = fallbackOperation;
    phase = "PREPARING";
    operationStartedAt = 0;
    phaseStartedAt = 0;
    lastEnginePhase = "";
    planTotalFiles = undefined;
    planApplyFiles = undefined;
    packPlannedDownloadBytes = undefined;
    packDownloadBytesKnown = false;
    packPlannedDownloadFiles = 0;
    runtimePlannedDownloadBytes = undefined;
    runtimeDownloadBytesKnown = false;
    runtimePlannedDownloadFiles = 0;
    downloads.clear();
    completedFiles = 0;
    currentItemLabel = undefined;
    speedTracker.reset();
    rawEvents = 0;
    forwardedEvents = 0;
    lastEmitAt = 0;
    pendingFlush = false;
  }

  function lockedDownloadTotalBytes(): number | undefined {
    if (phase === "PREPARING_RUNTIME" && runtimeDownloadBytesKnown) {
      return runtimePlannedDownloadBytes;
    }
    if (phase === "DOWNLOADING" && packDownloadBytesKnown) {
      return packPlannedDownloadBytes;
    }
    return undefined;
  }

  function downloadBytesPlanKnown(): boolean {
    if (phase === "PREPARING_RUNTIME") return runtimeDownloadBytesKnown;
    if (phase === "DOWNLOADING") return packDownloadBytesKnown;
    return false;
  }

  function countCompletedDownloads(): number {
    let n = 0;
    for (const d of downloads.values()) {
      if (d.done) n += 1;
    }
    return n;
  }

  function aggregateBytes(): { completedBytes?: number; totalBytes?: number } {
    let completedBytes = 0;
    for (const d of downloads.values()) {
      if (d.done) {
        completedBytes += d.verifiedSize > 0 ? d.verifiedSize : d.bytesReceived;
      } else {
        completedBytes += d.bytesReceived;
      }
    }

    const lockedTotal = lockedDownloadTotalBytes();
    if (lockedTotal !== undefined && lockedTotal > 0) {
      return {
        completedBytes: completedBytes > 0 ? completedBytes : 0,
        totalBytes: lockedTotal
      };
    }

    if (completedBytes > 0) return { completedBytes };
    return {};
  }

  function buildDto(forceFinal = false): InstallProgressDto {
    const t = now();
    const elapsedMs =
      operationStartedAt > 0 ? Math.max(0, t - operationStartedAt) : undefined;

    const byteAgg = aggregateBytes();
    let completedBytes = byteAgg.completedBytes;
    let totalBytes = byteAgg.totalBytes;

    let completedFilesOut: number | undefined;
    let totalFilesOut: number | undefined;
    let metricScope: InstallProgressDto["metricScope"];

    const bytePercentEligible =
      downloadBytesPlanKnown() &&
      totalBytes !== undefined &&
      totalBytes > 0 &&
      completedBytes !== undefined &&
      completedBytes <= totalBytes &&
      (phase === "DOWNLOADING" || phase === "PREPARING_RUNTIME");

    const filePercentEligible =
      planApplyFiles !== undefined &&
      planApplyFiles > 0 &&
      completedFiles <= planApplyFiles &&
      (phase === "DOWNLOADING" ||
        phase === "APPLYING" ||
        phase === "VERIFYING" ||
        phase === "COMMITTING");

    const downloadPhaseActive = phase === "DOWNLOADING" || phase === "PREPARING_RUNTIME";
    const plannedDownloadFiles =
      phase === "PREPARING_RUNTIME" ? runtimePlannedDownloadFiles : packPlannedDownloadFiles;

    if (bytePercentEligible) {
      metricScope = "download";
      completedFilesOut = undefined;
      totalFilesOut = undefined;
    } else if (
      downloadPhaseActive &&
      !downloadBytesPlanKnown() &&
      plannedDownloadFiles > 0 &&
      completedBytes !== undefined
    ) {
      metricScope = "download";
      completedFilesOut = countCompletedDownloads();
      totalFilesOut = plannedDownloadFiles;
    } else if (filePercentEligible && !bytePercentEligible) {
      metricScope = "files";
      completedFilesOut = completedFiles;
      totalFilesOut = planApplyFiles;
      completedBytes = undefined;
      totalBytes = undefined;
    } else if (completedFiles > 0 && planTotalFiles !== undefined) {
      completedFilesOut = completedFiles;
      totalFilesOut = planTotalFiles;
    }

    const speedEligible = bytePercentEligible || completedBytes !== undefined;
    const bytesPerSecond = speedEligible
      ? speedTracker.observe(completedBytes ?? 0, t)
      : undefined;

    let etaSeconds: number | undefined;
    if (
      bytePercentEligible &&
      totalBytes !== undefined &&
      completedBytes !== undefined &&
      bytesPerSecond !== undefined
    ) {
      etaSeconds = computeEtaSeconds(totalBytes - completedBytes, bytesPerSecond);
    }

    const dto = normalizeInstallProgress(
      {
        phase,
        operation,
        completedItems: completedFilesOut,
        totalItems: totalFilesOut,
        completedBytes,
        totalBytes,
        currentItemLabel,
        elapsedMs,
        bytesPerSecond,
        etaSeconds,
        metricScope,
      },
      fallbackOperation,
    );

    if (forceFinal && phase === "COMPLETED") {
      return { ...dto, indeterminate: false, percent: 100 };
    }
    return dto;
  }

  function emitNow(force = false): void {
    pendingFlush = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const dto = buildDto(force);
    onProgress(dto);
    forwardedEvents += 1;
    lastEmitAt = now();
  }

  function scheduleEmit(force = false): void {
    if (force) {
      emitNow(true);
      return;
    }
    const t = now();
    if (t - lastEmitAt >= minEmitIntervalMs) {
      emitNow(false);
      return;
    }
    pendingFlush = true;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (pendingFlush) emitNow(false);
    }, minEmitIntervalMs - (t - lastEmitAt));
  }

  function logPhaseComplete(prevPhase: string, durationMs: number): void {
    if (!prevPhase || durationMs <= 0) return;
    log({
      event: "install.phase.complete",
      operation: operation.toUpperCase(),
      phase: prevPhase,
      durationMs,
    });
  }

  function logOperationComplete(durationMs: number): void {
    if (durationMs <= 0) return;
    log({
      event: "install.operation.complete",
      operation: operation.toUpperCase(),
      durationMs,
    });
  }

  function transitionPhase(nextRaw: string): boolean {
    const next = mapOperationPhase(nextRaw);
    if (next === phase && lastEnginePhase === nextRaw) return false;
    const t = now();
    if (phaseStartedAt > 0 && lastEnginePhase) {
      logPhaseComplete(lastEnginePhase, t - phaseStartedAt);
    }
    if (next === "COMPLETED" && operationStartedAt > 0) {
      logOperationComplete(t - operationStartedAt);
    }
    const phaseChanged = next !== phase;
    if (phaseChanged) {
      phase = next;
      phaseStartedAt = t;
      if (next === "DOWNLOADING" || next === "PREPARING_RUNTIME") {
        speedTracker.reset();
        downloads.clear();
      }
    }
    lastEnginePhase = nextRaw;
    return phaseChanged;
  }

  function handleEvent(event: EngineProgressEvent): void {
    rawEvents += 1;
    const data = event.data;

    switch (event.type) {
      case "OPERATION_PROGRESS": {
        const op = data["operation"];
        if (
          op === "install" ||
          op === "update" ||
          op === "repair" ||
          op === "uninstall" ||
          op === "status"
        ) {
          operation = op;
        }
        if (operationStartedAt === 0) {
          operationStartedAt = now();
          phaseStartedAt = operationStartedAt;
        }
        const phaseChanged = transitionPhase(String(data["phase"] ?? "PREPARING"));
        const terminal = phase === "COMPLETED" || phase === "FAILED";
        scheduleEmit(phaseChanged || terminal);
        break;
      }
      case "PLAN_READY": {
        if (data["dryRun"] === true) break;
        const entryCount = nonNegInt(data["entryCount"]);
        const summary =
          typeof data["summary"] === "object" && data["summary"] !== null
            ? (data["summary"] as Record<string, unknown>)
            : undefined;
        if (entryCount !== undefined) planTotalFiles = entryCount;
        if (summary) {
          const dl = nonNegInt(summary["download"]) ?? 0;
          const rep = nonNegInt(summary["replace"]) ?? 0;
          const del = nonNegInt(summary["deleteManaged"]) ?? 0;
          const applyTotal = dl + rep + del;
          if (applyTotal > 0) planApplyFiles = applyTotal;
        }
        const plannedBytes = nonNegInt(data["plannedDownloadBytes"]);
        const plannedFiles = nonNegInt(data["plannedDownloadFiles"]) ?? 0;
        packPlannedDownloadFiles = plannedFiles;
        if (data["hasUnknownDownloadSize"] === true) {
          packDownloadBytesKnown = false;
          packPlannedDownloadBytes = undefined;
        } else if (plannedBytes !== undefined) {
          packPlannedDownloadBytes = plannedBytes;
          packDownloadBytesKnown = true;
        }
        scheduleEmit(false);
        break;
      }
      case "RUNTIME_PLAN_READY": {
        if (data["dryRun"] === true) break;
        const plannedBytes = nonNegInt(data["plannedDownloadBytes"]);
        const plannedFiles = nonNegInt(data["plannedDownloadFiles"]) ?? 0;
        runtimePlannedDownloadFiles = plannedFiles;
        if (data["hasUnknownDownloadSize"] === true) {
          runtimeDownloadBytesKnown = false;
          runtimePlannedDownloadBytes = undefined;
        } else if (plannedBytes !== undefined) {
          runtimePlannedDownloadBytes = plannedBytes;
          runtimeDownloadBytesKnown = true;
        }
        scheduleEmit(false);
        break;
      }
      case "DOWNLOAD_STARTED": {
        const id = typeof data["id"] === "string" ? data["id"] : undefined;
        if (!id) break;
        const expectedSize = nonNegInt(data["expectedSize"]);
        downloads.set(id, {
          bytesReceived: 0,
          expectedSize: expectedSize ?? -1,
          done: false,
          verifiedSize: 0,
        });
        const label = basenameSafe(data["targetPath"]);
        if (label) currentItemLabel = label;
        scheduleEmit(false);
        break;
      }
      case "DOWNLOAD_PROGRESS": {
        const id = typeof data["id"] === "string" ? data["id"] : undefined;
        if (!id) break;
        const track = downloads.get(id);
        if (!track) break;
        const received = nonNegInt(data["bytesReceived"]);
        if (received !== undefined) track.bytesReceived = received;
        scheduleEmit(false);
        break;
      }
      case "DOWNLOAD_VERIFIED": {
        const id = typeof data["id"] === "string" ? data["id"] : undefined;
        if (!id) break;
        const track = downloads.get(id);
        if (!track) break;
        track.done = true;
        track.bytesReceived = nonNegInt(data["size"]) ?? track.bytesReceived;
        track.verifiedSize = track.bytesReceived;
        scheduleEmit(false);
        break;
      }
      case "FILE_INSTALLED":
      case "FILE_KEPT":
      case "FILE_REMOVED": {
        completedFiles += 1;
        const label = logicalIdLabel(data["logicalId"]);
        if (label) currentItemLabel = label;
        scheduleEmit(false);
        break;
      }
      case "OPERATION_FAILED": {
        transitionPhase("FAILED");
        speedTracker.reset();
        scheduleEmit(true);
        break;
      }
      default:
        break;
    }
  }

  function flush(): void {
    emitNow(true);
  }

  return { handleEvent, flush, reset, getStats: () => ({ rawEvents, forwardedEvents }) };
}
