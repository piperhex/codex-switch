export type {
  AccessMode, ApprovalReply, GuiEvent, Item, ListResponse, Model, Request,
  Skill, SkillReference, SkillsResponse, Thread, Turn,
} from '../../../apps/desktop/src/pages/codexGui/types';
import type { GuiEvent, Model, SkillReference, Thread } from '../../../apps/desktop/src/pages/codexGui/types';
import type { ConnectionMode } from '../protocol';
import { DEFAULT_COMPOSER, type ComposerSettings } from '../composer';
import { emptySidebar, type SidebarSnapshot } from '../sidebar';

export interface SendInput {
  text: string;
  images?: string[];
  skills?: SkillReference[];
  model?: string;
  effort?: string;
  access: ComposerSettings['access'];
}

export interface ChatProject { cwd: string; label: string }

export interface ChatState {
  mode: ConnectionMode;
  ready: boolean;
  threads: Thread[];
  selected: Thread | null;
  draftProject: ChatProject | null;
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
  historyLoading: boolean;
  historyLoadingMore: boolean;
  historyHasMore: boolean;
  sending: boolean;
  compacting?: string;
  error: string;
}

export function initialChatState(): ChatState {
  return { mode: 'offline', ready: false, threads: [], selected: null, draftProject: null, selectedArchived: false,
    models: [], approvals: [], cursor: null,
    settings: { ...DEFAULT_COMPOSER }, settingsBusy: false, settingsError: '', sidebar: emptySidebar(),
    search: '', archived: false, loading: false, historyLoading: false, historyLoadingMore: false,
    historyHasMore: false, sending: false, error: '' };
}
