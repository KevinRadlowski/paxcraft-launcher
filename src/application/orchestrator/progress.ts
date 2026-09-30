import { randomUUID } from "node:crypto";
import type { LauncherOperation, OperationPhase, OperationProgress } from "./types.js";
import type { ProgressEmitter } from "../../instance/events/index.js";

export function createOperationId(): string {
  return randomUUID();
}

export function emitOperationProgress(
  emitter: ProgressEmitter | undefined,
  progress: OperationProgress
): void {
  emitter?.emit("OPERATION_PROGRESS", {
    operationId: progress.operationId,
    operation: progress.operation,
    phase: progress.phase,
    ...(progress.completedItems !== undefined ? { completedItems: progress.completedItems } : {}),
    ...(progress.totalItems !== undefined ? { totalItems: progress.totalItems } : {}),
    ...(progress.completedBytes !== undefined ? { completedBytes: progress.completedBytes } : {}),
    ...(progress.totalBytes !== undefined ? { totalBytes: progress.totalBytes } : {}),
    ...(progress.currentItem !== undefined ? { currentItem: progress.currentItem } : {})
  });
}

export function phaseProgress(
  operationId: string,
  operation: LauncherOperation,
  phase: OperationPhase,
  extra: Partial<OperationProgress> = {}
): OperationProgress {
  return { operationId, operation, phase, ...extra };
}
