import { loadAccount } from "../core/service";
import { presentAccount } from "./presenter";

export function routeRequest(accountId: string): string {
  const account = loadAccount(accountId);
  return JSON.stringify(presentAccount(account));
}
