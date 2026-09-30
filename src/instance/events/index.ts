export type ProgressEventType =
  | "PLAN_STARTED"
  | "PLAN_READY"
  | "DOWNLOAD_STARTED"
  | "DOWNLOAD_PROGRESS"
  | "DOWNLOAD_VERIFIED"
  | "FILE_INSTALLED"
  | "FILE_KEPT"
  | "FILE_REMOVED"
  | "STATE_WRITTEN"
  | "INSTALL_COMPLETE"
  | "AUDIT_STARTED"
  | "AUDIT_COMPLETE"
  | "REPAIR_STARTED"
  | "REPAIR_COMPLETE"
  | "RUNTIME_RESOLUTION_STARTED"
  | "MINECRAFT_METADATA_RESOLVED"
  | "FABRIC_METADATA_RESOLVED"
  | "JAVA_DISCOVERED"
  | "RUNTIME_PLAN_READY"
  | "RUNTIME_DOWNLOAD_STARTED"
  | "RUNTIME_DOWNLOAD_PROGRESS"
  | "RUNTIME_FILE_VERIFIED"
  | "NATIVES_EXTRACTION_STARTED"
  | "NATIVES_EXTRACTION_COMPLETE"
  | "RUNTIME_READY"
  | "LAUNCH_PREPARATION_STARTED"
  | "LAUNCH_SPEC_READY"
  | "GAME_PROCESS_STARTED"
  | "GAME_STDOUT"
  | "GAME_STDERR"
  | "GAME_PROCESS_EXITED"
  | "GAME_PROCESS_FAILED"
  | "AUTH_FLOW_STARTED"
  | "AUTH_CALLBACK_RECEIVED"
  | "MICROSOFT_AUTHENTICATED"
  | "XBOX_AUTHENTICATED"
  | "XSTS_AUTHORIZED"
  | "MINECRAFT_AUTHENTICATED"
  | "ENTITLEMENTS_VERIFIED"
  | "PROFILE_LOADED"
  | "AUTH_SESSION_READY"
  | "AUTH_REFRESHED"
  | "AUTH_LOGGED_OUT"
  | "AUTH_FAILED"
  | "OPERATION_PROGRESS"
  | "OPERATION_COMPLETE"
  | "OPERATION_FAILED"
  | "PLAY_PROGRESS"
  | "PLAY_ACCOUNT_METADATA_WARNING"
  | "PLAY_CLEANUP_WARNING";

export interface ProgressEvent {
  type: ProgressEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

export type ProgressListener = (event: ProgressEvent) => void;

export class ProgressEmitter {
  private readonly listeners = new Set<ProgressListener>();

  on(listener: ProgressListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(type: ProgressEventType, data: Record<string, unknown> = {}): void {
    const event: ProgressEvent = {
      type,
      timestamp: new Date().toISOString(),
      data
    };
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        // listeners must not break the engine
      }
    }
  }
}
