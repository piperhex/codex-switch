import { accounts } from './accounts';
import { app } from './app';
import { chat } from './chat';
import { settings } from './settings';
import { shared } from './shared';
import { errors } from './errors';
import { downloads } from './downloads';
import { threadActions } from './threadActions';

export const messages: Readonly<Record<string, string>> = {
  ...accounts, ...app, ...chat, ...settings, ...shared, ...errors, ...downloads, ...threadActions,
};
