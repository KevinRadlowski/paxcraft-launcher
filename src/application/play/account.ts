import { ErrorCode, LauncherError } from "../../core/errors/index.js";
import type { AccountRecord } from "../../auth/account.js";
import type { AccountRegistry } from "../../auth/accountsFile.js";

/**
 * Deterministic account selection for PLAY.
 * Never picks arbitrarily among multiple accounts.
 */
export async function resolvePlayAccount(
  accounts: AccountRegistry,
  accountId: string | undefined
): Promise<AccountRecord> {
  const list = await Promise.resolve(accounts.list());

  if (accountId) {
    const found = await Promise.resolve(accounts.get(accountId));
    if (!found) {
      throw new LauncherError(ErrorCode.AUTH_ACCOUNT_NOT_FOUND, "account not found", {
        accountId
      });
    }
    return found;
  }

  if (list.length === 0) {
    throw new LauncherError(ErrorCode.AUTH_ACCOUNT_REQUIRED, "no accounts available", {});
  }

  if (list.length === 1) {
    return list[0]!;
  }

  const withLastUsed = list
    .filter((a) => typeof a.lastUsedAtMs === "number" && a.lastUsedAtMs > 0)
    .slice()
    .sort((a, b) => b.lastUsedAtMs - a.lastUsedAtMs);

  if (withLastUsed.length === 0) {
    throw new LauncherError(
      ErrorCode.AUTH_ACCOUNT_REQUIRED,
      "multiple accounts; specify accountId or lastUsed",
      { accountCount: list.length }
    );
  }

  // Distinct max lastUsed — if tie at top, refuse
  const top = withLastUsed[0]!;
  const tied = withLastUsed.filter((a) => a.lastUsedAtMs === top.lastUsedAtMs);
  if (tied.length !== 1) {
    throw new LauncherError(
      ErrorCode.AUTH_ACCOUNT_REQUIRED,
      "multiple accounts with equal lastUsed; specify accountId",
      { accountCount: list.length }
    );
  }
  return top;
}

export async function markAccountLastUsed(
  accounts: AccountRegistry,
  account: AccountRecord,
  nowMs: number
): Promise<void> {
  await Promise.resolve(
    accounts.upsert({
      ...account,
      lastUsedAtMs: nowMs
    })
  );
}
