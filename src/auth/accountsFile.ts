import { readFile } from "node:fs/promises";
import path from "node:path";
import { ErrorCode, LauncherError } from "../core/errors/index.js";
import { writeFileAtomic } from "../download/fs/index.js";
import type { AccountRecord } from "./account.js";
import { InMemoryAccountRegistry } from "./account.js";

export interface AccountRegistry {
  upsert(record: AccountRecord): Promise<void> | void;
  get(accountId: string): Promise<AccountRecord | undefined> | AccountRecord | undefined;
  list(): Promise<AccountRecord[]> | AccountRecord[];
  delete(accountId: string): Promise<void> | void;
}

export function accountsRegistryPath(dataDir: string): string {
  return path.join(dataDir, "state", "accounts.json");
}

interface AccountsFileV1 {
  version: 1;
  accounts: AccountRecord[];
}

/**
 * Atomic JSON account metadata store — NON-SENSITIVE fields only.
 * Never write tokens / refresh / code / verifier here.
 */
export class FileAccountRegistry implements AccountRegistry {
  private readonly filePath: string;
  private cache: InMemoryAccountRegistry | null = null;

  constructor(dataDir: string) {
    this.filePath = accountsRegistryPath(dataDir);
  }

  async upsert(record: AccountRecord): Promise<void> {
    assertSafeRecord(record);
    const reg = await this.load();
    reg.upsert(sanitizeRecord(record));
    await this.persist(reg);
  }

  async get(accountId: string): Promise<AccountRecord | undefined> {
    return (await this.load()).get(accountId);
  }

  async list(): Promise<AccountRecord[]> {
    return (await this.load()).list();
  }

  async delete(accountId: string): Promise<void> {
    const reg = await this.load();
    reg.delete(accountId);
    await this.persist(reg);
  }

  private async load(): Promise<InMemoryAccountRegistry> {
    if (this.cache) return this.cache;
    const reg = new InMemoryAccountRegistry();
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as AccountsFileV1;
      if (parsed?.version !== 1 || !Array.isArray(parsed.accounts)) {
        throw new LauncherError(ErrorCode.CORRUPT_STATE, "invalid accounts.json", {});
      }
      for (const a of parsed.accounts) {
        assertSafeRecord(a);
        reg.upsert(sanitizeRecord(a));
      }
    } catch (e) {
      if (LauncherError.isLauncherError(e)) throw e;
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new LauncherError(ErrorCode.CORRUPT_STATE, "accounts.json unreadable", {});
      }
    }
    this.cache = reg;
    return reg;
  }

  private async persist(reg: InMemoryAccountRegistry): Promise<void> {
    const body: AccountsFileV1 = {
      version: 1,
      accounts: reg.list().map(sanitizeRecord)
    };
    const json = JSON.stringify(body, null, 2);
    // Belt-and-suspenders: refuse to write if any forbidden key leaked into serialization
    if (/refresh|access_token|accessToken|code_verifier|Xbox|xsts|Bearer /i.test(json)) {
      throw new LauncherError(ErrorCode.AUTH_STORE_ERROR, "accounts.json refused sensitive content", {});
    }
    await writeFileAtomic(this.filePath, json);
    this.cache = reg;
  }
}

function sanitizeRecord(r: AccountRecord): AccountRecord {
  const out: AccountRecord = {
    accountId: r.accountId,
    minecraftUuid: r.minecraftUuid,
    minecraftUsername: r.minecraftUsername,
    lastUsedAtMs: r.lastUsedAtMs
  };
  if (r.metadata) {
    const meta: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.metadata)) {
      if (/token|secret|password|refresh|verifier/i.test(k)) continue;
      meta[k] = String(v).slice(0, 200);
    }
    if (Object.keys(meta).length) out.metadata = meta;
  }
  return out;
}

function assertSafeRecord(r: AccountRecord): void {
  if (!r?.accountId || !r.minecraftUuid || !r.minecraftUsername) {
    throw new LauncherError(ErrorCode.CORRUPT_STATE, "invalid account record", {});
  }
}
