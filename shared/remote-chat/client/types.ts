export type {
  AccessMode, ApprovalReply, GuiEvent, Item, ListResponse, Model, Request, Thread, Turn,
} from '../../../apps/desktop/src/pages/codexGui/types';
import type { GuiEvent, Model, Thread } from '../../../apps/desktop/src/pages/codexGui/types';
import type { ConnectionMode } from '../protocol';
import { DEFAULT_COMPOSER, type ComposerSettings } from '../composer';
import { emptySidebar, type SidebarSnapshot } from '../sidebar';

export interface ChatState {
  mode: ConnectionMode;
  ready: boolean;
  threads: Thread[];
  selected: Thread | null;
  selectedArchived: boolean;
  models: Model[];
  settings: ComposerSettings;
  settingsBusy: boolean;
  settingsError: string;
  sidebar: SidebarSnapshot;
  approvals: GuiEvent[];
  cursor: string | null;
  search: string;
  archived: boolean;
  loading: boolean;
  sending: boolean;
  error: string;
}

export function initialChatState(): ChatState {
  return { mode: 'offline', ready: false, threads: [], selected: null, selectedArchived: false,
    models: [], approvals: [], cursor: null,
    settings: { ...DEFAULT_COMPOSER }, settingsBusy: false, settingsError: '', sidebar: emptySidebar(),
    search: '', archived: false, loading: false, sending: false, error: '' };
}
