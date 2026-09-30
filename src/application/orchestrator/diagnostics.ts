import type { InstanceStatusReport, OperationResult } from "./types.js";
import { LAUNCHER_VERSION } from "../../version.js";

/** Human-readable status (no secrets / no home paths). */
export function formatStatusHuman(report: InstanceStatusReport): string {
  const lines = [
    `SweetCraft Launcher ${LAUNCHER_VERSION}`,
    "",
    `Channel: ${report.channel}`,
    `Installed: ${report.installedVersion ?? "(none)"}`,
    `Latest: ${report.latestVersion ?? "(unknown)"}`,
    `Status: ${report.status}`
  ];
  return lines.join("\n");
}

export function formatOperationHuman(result: OperationResult): string {
  if (result.outcome === "NOOP") {
    return `${result.operation} complete (already up to date).`;
  }
  return [
    `${result.operation} complete.`,
    `Release: ${result.releaseVersion} (seq ${result.releaseSequence})`,
    `Changed files: ${result.changedFiles}`,
    `Downloaded: ${result.downloadedFiles} files`
  ].join("\n");
}

export function statusToJson(report: InstanceStatusReport): Record<string, unknown> {
  return {
    operationId: report.operationId,
    operation: report.operation,
    status: report.status,
    channel: report.channel,
    installedVersion: report.installedVersion,
    installedSequence: report.installedSequence,
    latestVersion: report.latestVersion,
    latestSequence: report.latestSequence,
    findings: report.findings,
    lockPresent: report.lockPresent,
    orphanTransaction: report.orphanTransaction
  };
}

export function operationToJson(result: OperationResult): Record<string, unknown> {
  return {
    operationId: result.operationId,
    operation: result.operation,
    outcome: result.outcome,
    releaseVersion: result.releaseVersion,
    releaseSequence: result.releaseSequence,
    changedFiles: result.changedFiles,
    downloadedFiles: result.downloadedFiles,
    downloadedBytes: result.downloadedBytes
  };
}
