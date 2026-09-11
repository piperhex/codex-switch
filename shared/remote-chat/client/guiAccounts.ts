import { GUI_ACCOUNTS_EVENT, type GuiAccountsClient } from '../guiAccounts';
import type { GuiEvent } from './types';

export function createGuiAccountsClient(options: {
  request: <T>(body: unknown) => Promise<T>;
  subscribe: (listener: (event: GuiEvent) => void) => () => void;
}): GuiAccountsClient {
  return {
    read: () => options.request({ operation: 'guiAccountsRead' }),
    select: (selection) => options.request({ operation: 'guiAccountSelect', selection }),
    subscribe: (changed) => options.subscribe((event) => {
      if (event.method === GUI_ACCOUNTS_EVENT) changed();
    }),
  };
}
