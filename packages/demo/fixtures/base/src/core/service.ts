import { presentAccount } from "../api/presenter";
import type { Account } from "../shared/contracts";

export function loadAccount(id: string): Account {
  const account: Account = { id, name: "Demo Team", plan: "team" };
  presentAccount(account);
  return account;
}
