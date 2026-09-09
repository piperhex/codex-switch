export type {
  AccessMode, ApprovalReply, GuiEvent, Item, ListResponse, Model, Request, Thread, Turn,
} from '../../../apps/desktop/src/pages/codexGui/types';
import type { GuiEvent, Model, Thread } from '../../../apps/desktop/src/pages/codexGui/types';
import type { ConnectionMode } from '../protocol';

export interface ChatState {
  mode: ConnectionMode;
  threads: Thread[];
  selected: Thread | null;
  models: Model[];
  approvals: GuiEvent[];
  cursor: string | null;
  search: string;
  archived: boolean;
  loading: boolean;
  sending: boolean;
  error: string;
}

export function initialChatState(): ChatState {
  return { mode: 'offline', threads: [], selected: null, models: [], approvals: [], cursor: null,
    search: '', archived: false, loading: false, sending: false, error: '' };
}
