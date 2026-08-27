import { presentAccount } from "../api/presenter";
import type { Account } from "../shared/contracts";

function normalizeAccountId(value: string): string {
  return value.trim().toLowerCase();
}

export function loadAccount(id: string): Account {
  const account: Account = {
    id: normalizeAccountId(id),
    name: "Demo Team",
    plan: "team",
  };
  presentAccount(account);
  return account;
}
