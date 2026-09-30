import type { LaunchSpec, SanitizedLaunchSpec } from "./types.js";
import { redactSensitiveInString } from "./placeholders.js";

const REDACTED = "<redacted>";

/**
 * Diagnostic copy of LaunchSpec with secrets removed.
 * Never include raw accessToken in logs, events, or CLI summaries.
 * Never includes argfile contents or a path that would imply reading secrets.
 */
export function sanitizeLaunchSpecForLogging(spec: LaunchSpec, secrets: string[]): SanitizedLaunchSpec {
  const redactList = (arr: readonly string[]) =>
    arr.map((a) => redactSensitiveInString(a, secrets));

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(spec.environment)) {
    env[k] = looksSensitiveEnv(k) ? REDACTED : redactSensitiveInString(v, secrets);
  }

  const out: SanitizedLaunchSpec = {
    javaExecutable: spec.javaExecutable,
    workingDirectory: spec.workingDirectory,
    mainClass: spec.mainClass,
    classpathEntries: [...spec.classpathEntries],
    jvmArgs: redactList(spec.jvmArgs),
    gameArgs: redactList(spec.gameArgs),
    argv: redactList(spec.argv),
    environment: env,
    nativesDirectory: spec.nativesDirectory,
    memory: { ...spec.memory },
    features: { ...spec.features },
    metadata: { ...spec.metadata }
  };
  if (spec.argfilePlan) {
    out.argfileRequired = true;
  }
  return out;
}

function looksSensitiveEnv(key: string): boolean {
  const k = key.toUpperCase();
  return k.includes("TOKEN") || k.includes("SECRET") || k.includes("PASSWORD") || k.includes("AUTH");
}

export function sanitizeProcessOutputLine(line: string, secrets: string[]): string {
  return redactSensitiveInString(line, secrets);
}
