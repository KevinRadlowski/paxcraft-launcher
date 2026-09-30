/**
 * Human CLI diagnostics for `launcher:play` progress / Minecraft process lines.
 *
 * Authority for sanitization is NodeMinecraftProcessRunner (sanitizeProcessOutputLine).
 * This module only echoes the already-safe `line` string — never argv/env/tokens.
 */

export type PlayCliDiagnosticEvent = {
  readonly type: string;
  readonly data?: unknown;
};

/**
 * Format a ProgressEmitter event for human CLI output.
 * Returns null when the event should be ignored (unknown type or invalid payload).
 */
export function formatPlayCliDiagnosticLine(e: PlayCliDiagnosticEvent): string | null {
  if (e.type === "PLAY_PROGRESS") {
    const data = e.data;
    const phase =
      data !== null &&
      typeof data === "object" &&
      "phase" in data &&
      typeof (data as { phase: unknown }).phase === "string"
        ? (data as { phase: string }).phase
        : "?";
    return `[play] ${phase}`;
  }

  if (e.type === "GAME_STDOUT") {
    const line = extractSanitizedLine(e.data);
    if (line === null) return null;
    return `[minecraft] ${line}`;
  }

  if (e.type === "GAME_STDERR") {
    const line = extractSanitizedLine(e.data);
    if (line === null) return null;
    return `[minecraft:stderr] ${line}`;
  }

  return null;
}

/** Read only `data.line` when it is a string — ignore everything else. */
function extractSanitizedLine(data: unknown): string | null {
  if (data === null || typeof data !== "object") return null;
  if (!("line" in data)) return null;
  const line = (data as { line: unknown }).line;
  return typeof line === "string" ? line : null;
}
