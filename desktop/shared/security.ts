/** Pure BrowserWindow preference assertions — no Electron runtime required. */

export interface SecureWebPreferenceSnapshot {
  contextIsolation?: boolean;
  nodeIntegration?: boolean;
  sandbox?: boolean;
  webviewTag?: boolean;
}

export function assertSecureWebPreferences(prefs: SecureWebPreferenceSnapshot): void {
  if (prefs.contextIsolation !== true) throw new Error("contextIsolation required");
  if (prefs.nodeIntegration === true) throw new Error("nodeIntegration forbidden");
  if (prefs.sandbox !== true) throw new Error("sandbox required");
  if (prefs.webviewTag === true) throw new Error("webviewTag forbidden");
}
