/**
 * Normalize 0.5A OperationPhase / progress payloads for renderer delivery.
 * Never emit filesystem paths or mutable backend objects.
 */

import type { InstallProgressDto, InstallProgressPhase } from "../../shared/contract.js";

const PHASE_MAP: Record<string, InstallProgressPhase> = {
  RESOLVING: "RESOLVING_RELEASE",
  INSPECTING: "INSPECTING",
  PLANNING: "PLANNING",
  DOWNLOADING: "DOWNLOADING",
  STAGING: "STAGING",
  APPLYING: "APPLYING",
  PREPARING_RUNTIME: "PREPARING_RUNTIME",
  VERIFYING: "VERIFYING",
  COMMITTING: "COMMITTING",
  CLEANUP: "CLEANUP",
  DONE: "COMPLETED",
  // Fake / conceptual aliases
  PREPARING: "PREPARING",
  RESOLVING_RELEASE: "RESOLVING_RELEASE",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED"
};

function boundedLabel(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (!t || t.length > 128) return undefined;
  // Reject path-like leakage.
  if (t.includes("\\") || t.includes("/") || t.includes(":") || t.includes("\0")) {
    return undefined;
  }
  return t;
}

function nonNegInt(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  if (v < 0 || v > Number.MAX_SAFE_INTEGER) return undefined;
  return Math.floor(v);
}

function optionalPosNumber(v: unknown): number | undefined {
  const n = nonNegInt(v);
  if (n === undefined || n <= 0) return undefined;
  return n;
}

function optionalPositiveFinite(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return undefined;
  return v;
}

function optionalMetricScope(v: unknown): InstallProgressDto["metricScope"] | undefined {
  return v === "download" || v === "files" ? v : undefined;
}

export function mapOperationPhase(raw: unknown): InstallProgressPhase {
  if (typeof raw !== "string") return "PREPARING";
  return PHASE_MAP[raw] ?? "PREPARING";
}

/**
 * Build safe InstallProgressDto. Percent only when a reliable denominator exists.
 */
export function normalizeInstallProgress(
  raw: {
    phase?: unknown;
    operation?: unknown;
    completedItems?: unknown;
    totalItems?: unknown;
    completedBytes?: unknown;
    totalBytes?: unknown;
    currentItem?: unknown;
    currentItemLabel?: unknown;
    elapsedMs?: unknown;
    bytesPerSecond?: unknown;
    etaSeconds?: unknown;
    metricScope?: unknown;
  },
  fallbackOperation: InstallProgressDto["operation"] = "install"
): InstallProgressDto {
  const phase = mapOperationPhase(raw.phase);
  const opRaw = raw.operation;
  const operation: InstallProgressDto["operation"] =
    opRaw === "install" ||
    opRaw === "update" ||
    opRaw === "repair" ||
    opRaw === "uninstall" ||
    opRaw === "status"
      ? opRaw
      : fallbackOperation;

  const completedFiles = nonNegInt(raw.completedItems);
  const totalFiles = nonNegInt(raw.totalItems);
  const completedBytes = nonNegInt(raw.completedBytes);
  const totalBytes = nonNegInt(raw.totalBytes);
  const label = boundedLabel(raw.currentItemLabel) ?? boundedLabel(raw.currentItem);

  let percent: number | undefined;
  let indeterminate = true;

  if (
    totalFiles !== undefined &&
    totalFiles > 0 &&
    completedFiles !== undefined &&
    completedFiles <= totalFiles
  ) {
    percent = Math.min(100, Math.max(0, Math.floor((completedFiles / totalFiles) * 100)));
    indeterminate = false;
  } else if (
    totalBytes !== undefined &&
    totalBytes > 0 &&
    completedBytes !== undefined &&
    completedBytes <= totalBytes
  ) {
    percent = Math.min(100, Math.max(0, Math.floor((completedBytes / totalBytes) * 100)));
    indeterminate = false;
  }

  if (phase === "COMPLETED") {
    indeterminate = false;
    percent = percent ?? 100;
  }
  if (phase === "FAILED") {
    indeterminate = false;
  }

  const dto: InstallProgressDto = {
    phase,
    operation,
    indeterminate
  };
  if (completedFiles !== undefined) (dto as { completedFiles?: number }).completedFiles = completedFiles;
  if (totalFiles !== undefined) (dto as { totalFiles?: number }).totalFiles = totalFiles;
  if (completedBytes !== undefined) (dto as { completedBytes?: number }).completedBytes = completedBytes;
  if (totalBytes !== undefined) (dto as { totalBytes?: number }).totalBytes = totalBytes;
  if (label) (dto as { currentItemLabel?: string }).currentItemLabel = label;
  if (percent !== undefined) (dto as { percent?: number }).percent = percent;

  const elapsedMs = nonNegInt(raw.elapsedMs);
  const bytesPerSecond = optionalPositiveFinite(raw.bytesPerSecond);
  const etaSeconds = optionalPosNumber(raw.etaSeconds);
  const metricScope = optionalMetricScope(raw.metricScope);
  if (elapsedMs !== undefined) (dto as { elapsedMs?: number }).elapsedMs = elapsedMs;
  if (bytesPerSecond !== undefined) {
    (dto as { bytesPerSecond?: number }).bytesPerSecond = bytesPerSecond;
  }
  if (etaSeconds !== undefined) (dto as { etaSeconds?: number }).etaSeconds = etaSeconds;
  if (metricScope !== undefined) (dto as { metricScope?: "download" | "files" }).metricScope = metricScope;

  return dto;
}

export function tryNormalizeInstallProgressEvent(raw: unknown): InstallProgressDto | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  try {
    return normalizeInstallProgress(raw as Record<string, unknown>);
  } catch {
    return null;
  }
}
