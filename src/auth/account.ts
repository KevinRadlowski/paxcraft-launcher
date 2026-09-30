export interface AccountRecord {
  accountId: string;
  minecraftUuid: string;
  minecraftUsername: string;
  lastUsedAtMs: number;
  /** Non-sensitive display metadata only. */
  metadata?: Record<string, string>;
}

export class InMemoryAccountRegistry {
  private readonly accounts = new Map<string, AccountRecord>();

  upsert(record: AccountRecord): void {
    this.accounts.set(record.accountId, record);
  }

  get(accountId: string): AccountRecord | undefined {
    return this.accounts.get(accountId);
  }

  list(): AccountRecord[] {
    return [...this.accounts.values()];
  }

  delete(accountId: string): void {
    this.accounts.delete(accountId);
  }
}

/** Stable internal id from Minecraft UUID — never use access tokens as ids. */
export function accountIdFromMinecraftUuid(uuid: string): string {
  return `mc:${uuid.toLowerCase()}`;
}
