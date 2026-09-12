export const GUI_ACCOUNTS_EVENT = 'guiAccounts/changed';

export type GuiAccountSelection = { kind: 'none' } | { kind: 'account' | 'provider'; id: string };
export type SelectableGuiAccount = Exclude<GuiAccountSelection, { kind: 'none' }>;
export interface GuiAccountChoice {
  kind: SelectableGuiAccount['kind'];
  id: string;
  name: string;
  detail: string;
  searchDetail?: string;
  available: boolean;
}
export interface GuiAccountsSnapshot {
  selection: GuiAccountSelection;
  choices: GuiAccountChoice[];
  running: boolean;
}
export interface GuiAccountsClient {
  read: () => Promise<GuiAccountsSnapshot>;
  select: (selection: SelectableGuiAccount) => Promise<GuiAccountSelection>;
  subscribe: (changed: () => void) => () => void;
}
