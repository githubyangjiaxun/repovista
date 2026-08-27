export interface Account {
  id: string;
  name: string;
  plan: "free" | "team";
}

export interface AccountView {
  id: string;
  label: string;
}
