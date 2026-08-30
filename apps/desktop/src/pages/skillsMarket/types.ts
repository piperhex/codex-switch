import type { Translate } from "../../i18n";
import type { OfficialPluginItem, SkillMarketItem } from "../../types";

export type SkillsMarketTab = "community" | "official" | "prompt";

export interface SkillsMarketNavigationProps {
  activeTab: SkillsMarketTab;
  onTabChange: (tab: SkillsMarketTab) => void;
}

export interface SkillsMarketPageProps {
  active: boolean;
  baseUrl?: string | null;
  authenticated: boolean;
  currentUserId?: string | null;
  onLogin: () => void;
  notify: (message: string) => void;
  t: Translate;
}

export interface CommunitySkillsMarketProps
  extends SkillsMarketPageProps, SkillsMarketNavigationProps {}

export interface OfficialPluginsMarketProps extends SkillsMarketNavigationProps {
  active: boolean;
  notify: (message: string) => void;
  t: Translate;
}

export interface SkillsMarketToolbarProps extends SkillsMarketNavigationProps {
  active: boolean;
  loading: boolean;
  onPublish?: () => void;
  onQueryChange: (query: string) => void;
  onRefresh: () => void;
  query: string;
  t: Translate;
}

export interface OfficialPluginGridProps {
  busyAction: OfficialPluginBusyAction | null;
  items: OfficialPluginItem[];
  onAction: (plugin: OfficialPluginItem, action: OfficialPluginAction) => Promise<void>;
  t: Translate;
}

export type OfficialPluginAction = "disable" | "enable" | "install" | "remove";

export interface OfficialPluginBusyAction {
  action: OfficialPluginAction;
  pluginId: string;
}

export interface PublishModalProps {
  editing?: SkillMarketItem | null;
  onClose: () => void;
  onPublished: () => Promise<void>;
  t: Translate;
}

export interface SkillInstallButtonProps {
  busyAction: CommunitySkillBusyAction | null;
  onInstall: (skill: SkillMarketItem) => Promise<void>;
  onRemove: (skill: SkillMarketItem) => Promise<void>;
  onSetEnabled: (skill: SkillMarketItem, enabled: boolean) => Promise<void>;
  skill: SkillMarketItem;
  t: Translate;
}

export interface SkillDetailModalProps extends SkillInstallButtonProps {
  isPublisher: boolean;
  onClose: () => void;
  onEdit: (skill: SkillMarketItem) => void;
  onPreviewError: (skillId: string) => void;
  preview: string | null;
  previewBroken: boolean;
}

export interface SkillMarketGridProps {
  authenticated: boolean;
  baseUrl?: string | null;
  brokenPreviews: Set<string>;
  busyAction: CommunitySkillBusyAction | null;
  currentUserId?: string | null;
  items: SkillMarketItem[];
  onEdit: (skill: SkillMarketItem) => void;
  onInstall: (skill: SkillMarketItem) => Promise<void>;
  onRemove: (skill: SkillMarketItem) => Promise<void>;
  onSetEnabled: (skill: SkillMarketItem, enabled: boolean) => Promise<void>;
  onOpen: (skillId: string) => void;
  onPreviewError: (skillId: string) => void;
  t: Translate;
}

export type CommunitySkillAction = "install" | "remove" | "toggle";

export interface CommunitySkillBusyAction {
  action: CommunitySkillAction;
  skillId: string;
}
