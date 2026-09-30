import type { ProgressEmitter } from "../../instance/events/index.js";
import type { PlayPhase } from "./types.js";

export function emitPlayProgress(
  emitter: ProgressEmitter | undefined,
  operationId: string,
  phase: PlayPhase,
  data: Record<string, unknown> = {}
): void {
  emitter?.emit("PLAY_PROGRESS", {
    operationId,
    phase,
    ...data
  });
}
