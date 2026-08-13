import type { Translate } from "../../i18n";
import type { SkillMarketItem } from "../../types";

export interface SkillsMarketPageProps {
  baseUrl?: string | null;
  authenticated: boolean;
  currentUserId?: string | null;
  onLogin: () => void;
  notify: (message: string) => void;
  t: Translate;
}

export interface PublishModalProps {
  editing?: SkillMarketItem | null;
  onClose: () => void;
  onPublished: () => Promise<void>;
  t: Translate;
}

export interface SkillInstallButtonProps {
  busy: boolean;
  onInstall: (skill: SkillMarketItem) => Promise<void>;
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
  busySkillId: string | null;
  currentUserId?: string | null;
  items: SkillMarketItem[];
  onEdit: (skill: SkillMarketItem) => void;
  onInstall: (skill: SkillMarketItem) => Promise<void>;
  onOpen: (skillId: string) => void;
  onPreviewError: (skillId: string) => void;
  t: Translate;
}
