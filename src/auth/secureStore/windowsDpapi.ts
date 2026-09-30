import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import {
  assertAccountId,
  assertRefreshToken,
  type SecureRefreshTokenStore,
  UnavailableSecureRefreshTokenStore
} from "./types.js";
import { writeFileAtomic } from "../../download/fs/index.js";

/**
 * Fixed PowerShell DPAPI helper (NO secrets in this string / argv).
 * Reads from stdin:
 *   line1: PROTECT | UNPROTECT
 *   line2: base64 payload
 * Writes base64 result to stdout.
 */
const DPAPI_PS_HELPER = [
  "$ErrorActionPreference='Stop'",
  "$op=[Console]::In.ReadLine()",
  "$b64=[Console]::In.ReadLine()",
  "$bytes=[Convert]::FromBase64String($b64)",
  "Add-Type -AssemblyName System.Security",
  "if($op -eq 'PROTECT'){",
  "$p=[System.Security.Cryptography.ProtectedData]::Protect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
  "[Console]::Out.Write([Convert]::ToBase64String($p))",
  "}elseif($op -eq 'UNPROTECT'){",
  "$p=[System.Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
  "[Console]::Out.Write([Convert]::ToBase64String($p))",
  "}else{throw 'bad op'}"
].join(";");

const MAX_DPAPI_STDOUT_BYTES = 256 * 1024;
const MAX_DPAPI_STDERR_BYTES = 16 * 1024;

/**
 * Windows DPAPI (CurrentUser) secure refresh-token store.
 *
 * Availability: constructed as available=true on win32. First DPAPI op is the
 * truth — failures map to AUTH_STORE_ERROR / AUTH_SECURE_STORAGE_UNAVAILABLE,
 * never plaintext. Optional probe() can mark unavailable early.
 */
export class WindowsDpapiSecureRefreshTokenStore implements SecureRefreshTokenStore {
  private _available = true;
  readonly kind = "windows-dpapi";
  private readonly dir: string;
  private probed = false;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, "secure", "ms-refresh");
  }

  get available(): boolean {
    return this._available;
  }

  /** Non-secret probe: protect a fixed marker. Marks unavailable on failure. */
  async probe(): Promise<boolean> {
    if (this.probed) return this._available;
    this.probed = true;
    try {
      const once = await dpapiProtect(Buffer.from("sweetcraft-dpapi-probe", "utf8"));
      if (!once) throw new Error("empty");
      return this._available;
    } catch {
      this._available = false;
      return false;
    }
  }

  async save(accountId: string, refreshToken: string): Promise<void> {
    assertAccountId(accountId);
    assertRefreshToken(refreshToken);
    if (!this._available) {
      throw new LauncherError(
        ErrorCode.AUTH_SECURE_STORAGE_UNAVAILABLE,
        "secure storage unavailable",
        {}
      );
    }
    await mkdir(this.dir, { recursive: true });
    try {
      const protectedB64 = await dpapiProtect(Buffer.from(refreshToken, "utf8"));
      await writeFileAtomic(this.filePath(accountId), protectedB64);
      this.probed = true;
    } catch (e) {
      if (LauncherError.isLauncherError(e)) {
        if (e.code === ErrorCode.AUTH_STORE_ERROR) this._available = false;
        throw e;
      }
      this._available = false;
      throw new LauncherError(ErrorCode.AUTH_SECURE_STORAGE_UNAVAILABLE, "DPAPI save failed", {});
    }
  }

  async load(accountId: string): Promise<string | null> {
    assertAccountId(accountId);
    let raw: string;
    try {
      raw = await readFile(this.filePath(accountId), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new LauncherError(ErrorCode.AUTH_STORE_ERROR, "secure store read failed", {});
    }
    try {
      return (await dpapiUnprotect(raw.trim())).toString("utf8");
    } catch {
      throw new LauncherError(ErrorCode.AUTH_STORE_ERROR, "secure store decrypt failed", {});
    }
  }

  async delete(accountId: string): Promise<void> {
    assertAccountId(accountId);
    try {
      await unlink(this.filePath(accountId));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new LauncherError(ErrorCode.AUTH_STORE_ERROR, "secure store delete failed", {});
      }
    }
  }

  async listAccountIds(): Promise<string[]> {
    try {
      const names = await readdir(this.dir);
      return names
        .filter((n) => n.endsWith(".dpapi"))
        .map((n) => decodeAccountId(n.slice(0, -".dpapi".length)));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new LauncherError(ErrorCode.AUTH_STORE_ERROR, "secure store list failed", {});
    }
  }

  private filePath(accountId: string): string {
    return path.join(this.dir, `${encodeAccountId(accountId)}.dpapi`);
  }
}

export function createPlatformSecureRefreshTokenStore(dataDir: string): SecureRefreshTokenStore {
  if (process.platform === "win32") {
    return new WindowsDpapiSecureRefreshTokenStore(dataDir);
  }
  return new UnavailableSecureRefreshTokenStore();
}

function encodeAccountId(accountId: string): string {
  return Buffer.from(accountId, "utf8").toString("base64url");
}

function decodeAccountId(encoded: string): string {
  return Buffer.from(encoded, "base64url").toString("utf8");
}

async function dpapiProtect(plain: Buffer): Promise<string> {
  return runDpapi("PROTECT", plain.toString("base64"));
}

async function dpapiUnprotect(protectedB64: string): Promise<Buffer> {
  return Buffer.from(await runDpapi("UNPROTECT", protectedB64), "base64");
}

async function runDpapi(op: "PROTECT" | "UNPROTECT", payloadB64: string): Promise<string> {
  if (process.platform !== "win32") {
    throw new LauncherError(ErrorCode.AUTH_SECURE_STORAGE_UNAVAILABLE, "DPAPI requires Windows", {});
  }
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", DPAPI_PS_HELPER],
      { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }
    );
    let stdout = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    child.stdout.on("data", (d: Buffer) => {
      stdoutBytes += d.byteLength;
      if (stdoutBytes <= MAX_DPAPI_STDOUT_BYTES) {
        stdout += d.toString("utf8");
      }
    });
    child.stderr.on("data", (d: Buffer) => {
      stderrBytes += d.byteLength;
      // Never copy stderr into LauncherError — only track size for fail-closed
      void stderrBytes;
      if (stderrBytes > MAX_DPAPI_STDERR_BYTES) {
        try {
          child.kill();
        } catch {
          // ignore
        }
      }
    });
    child.on("error", () => {
      reject(new LauncherError(ErrorCode.AUTH_STORE_ERROR, "DPAPI helper spawn failed", {}));
    });
    child.on("close", (code) => {
      if (stdoutBytes > MAX_DPAPI_STDOUT_BYTES) {
        reject(new LauncherError(ErrorCode.AUTH_STORE_ERROR, "DPAPI output too large", {}));
        return;
      }
      if (code !== 0 || !stdout.trim()) {
        // Never attach PowerShell stderr text
        reject(new LauncherError(ErrorCode.AUTH_STORE_ERROR, "DPAPI operation failed", {}));
        return;
      }
      resolve(stdout.trim());
    });
    // Secret only on stdin — never argv
    child.stdin.write(`${op}\n${payloadB64}\n`, "utf8");
    child.stdin.end();
  });
}

export async function wipeSecureRefreshDir(dataDir: string): Promise<void> {
  await rm(path.join(dataDir, "secure", "ms-refresh"), { recursive: true, force: true }).catch(
    () => undefined
  );
}
