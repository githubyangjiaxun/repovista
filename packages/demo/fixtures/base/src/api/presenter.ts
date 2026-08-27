import type { Account, AccountView } from "../shared/contracts";

export function presentAccount(account: Account): AccountView {
  return {
    id: account.id,
    label: `${account.name} (${account.plan})`,
  };
}
