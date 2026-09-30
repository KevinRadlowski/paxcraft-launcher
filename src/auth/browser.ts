import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ErrorCode, LauncherError } from "../core/errors/index.js";

const execFileAsync = promisify(execFile);

export type ExecFileLike = (
  file: string,
  args: readonly string[],
  options: { shell: boolean; windowsHide?: boolean }
) => Promise<{ stdout: string; stderr: string }>;

export interface SystemBrowser {
  /** Open URL in the default browser. URL must already be a full https:// authorization URL. */
  open(url: string): Promise<void>;
}

/** Windows opener without cmd.exe / PowerShell / shell. */
export const WINDOWS_URL_OPEN_EXECUTABLE = "rundll32.exe";

/**
 * Build argv for rundll32 FileProtocolHandler.
 * URL is always a separate argv element (never concatenated into a script).
 */
export function windowsUrlOpenArgs(url: string): string[] {
  return ["url.dll,FileProtocolHandler", url];
}

/**
 * Fake browser for offline tests — records opened URLs, never touches the OS.
 */
export class FakeSystemBrowser implements SystemBrowser {
  readonly opened: string[] = [];
  failNext = false;
  /** When true, enforce Microsoft login host (live-like). Default false for hermetic fixtures. */
  strictMicrosoftHost = false;

  async open(url: string): Promise<void> {
    assertHttpsAuthUrl(url, { expectMicrosoftHost: this.strictMicrosoftHost });
    if (this.failNext) {
      this.failNext = false;
      throw new LauncherError(ErrorCode.BROWSER_OPEN_FAILED, "fake browser open failed", {});
    }
    this.opened.push(url);
  }
}

/**
 * Windows: open default browser via rundll32 url.dll,FileProtocolHandler.
 * Does NOT use cmd.exe, PowerShell, or shell:true.
 * URL remains a dedicated argv element.
 */
export class WindowsSystemBrowser implements SystemBrowser {
  private readonly execFileImpl: ExecFileLike;
  private readonly expectMicrosoftHost: boolean;

  constructor(opts: { execFile?: ExecFileLike; expectMicrosoftHost?: boolean } = {}) {
    this.execFileImpl = opts.execFile ?? execFileAsync;
    this.expectMicrosoftHost = opts.expectMicrosoftHost ?? true;
  }

  async open(url: string): Promise<void> {
    assertHttpsAuthUrl(url, { expectMicrosoftHost: this.expectMicrosoftHost });
    if (process.platform !== "win32" && this.execFileImpl === execFileAsync) {
      throw new LauncherError(ErrorCode.BROWSER_OPEN_FAILED, "WindowsSystemBrowser requires win32", {});
    }
    try {
      await this.execFileImpl(WINDOWS_URL_OPEN_EXECUTABLE, windowsUrlOpenArgs(url), {
        shell: false,
        windowsHide: true
      });
    } catch (e) {
      if (LauncherError.isLauncherError(e)) throw e;
      throw new LauncherError(ErrorCode.BROWSER_OPEN_FAILED, "failed to open system browser", {});
    }
  }
}

/** Cross-platform helper for live CLI — Windows primary; others use platform openers without shell. */
export class DefaultSystemBrowser implements SystemBrowser {
  private readonly inner: SystemBrowser;

  constructor(opts: { execFile?: ExecFileLike } = {}) {
    if (process.platform === "win32" || opts.execFile) {
      this.inner = new WindowsSystemBrowser({
        ...(opts.execFile ? { execFile: opts.execFile } : {}),
        expectMicrosoftHost: true
      });
    } else if (process.platform === "darwin") {
      this.inner = {
        async open(url: string) {
          assertHttpsAuthUrl(url, { expectMicrosoftHost: true });
          try {
            await execFileAsync("open", [url], { shell: false });
          } catch {
            throw new LauncherError(ErrorCode.BROWSER_OPEN_FAILED, "failed to open system browser", {});
          }
        }
      };
    } else {
      this.inner = {
        async open(url: string) {
          assertHttpsAuthUrl(url, { expectMicrosoftHost: true });
          try {
            await execFileAsync("xdg-open", [url], { shell: false });
          } catch {
            throw new LauncherError(ErrorCode.BROWSER_OPEN_FAILED, "failed to open system browser", {});
          }
        }
      };
    }
  }

  open(url: string): Promise<void> {
    return this.inner.open(url);
  }
}

const MS_AUTH_HOSTS = new Set([
  "login.microsoftonline.com",
  "login.microsoft.com",
  "login.live.com"
]);

/**
 * Validate authorization URL before handing to the OS browser.
 * Hermetic tests: pass expectMicrosoftHost:false (or omit) when injecting non-MS hosts.
 */
export function assertHttpsAuthUrl(
  url: string,
  opts: { expectMicrosoftHost?: boolean } = {}
): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new LauncherError(ErrorCode.BROWSER_OPEN_FAILED, "invalid browser URL", {});
  }
  if (u.protocol !== "https:") {
    throw new LauncherError(ErrorCode.BROWSER_OPEN_FAILED, "browser URL must be HTTPS", {});
  }
  if (u.username || u.password) {
    throw new LauncherError(ErrorCode.BROWSER_OPEN_FAILED, "browser URL must not contain userinfo", {});
  }
  if (u.hash && u.hash !== "" && u.hash !== "#") {
    throw new LauncherError(ErrorCode.BROWSER_OPEN_FAILED, "browser URL must not contain a fragment", {});
  }
  if (opts.expectMicrosoftHost) {
    const host = u.hostname.toLowerCase();
    if (!MS_AUTH_HOSTS.has(host)) {
      throw new LauncherError(ErrorCode.BROWSER_OPEN_FAILED, "browser URL host not allowed", {});
    }
  }
}
