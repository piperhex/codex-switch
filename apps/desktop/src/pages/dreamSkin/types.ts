import type { Dispatch, RefObject, SetStateAction } from "react";
import type { Translate } from "../../i18n";
import type {
  DreamSkinAppearance,
  DreamSkinCommunityTheme,
  DreamSkinImportOptions,
  DreamSkinMarketResult,
  DreamSkinMarketTheme,
  DreamSkinResourcesStatus,
  DreamSkinStatus,
  DreamSkinThemeSummary,
} from "../../types";

export type DreamSkinPageProps = {
  t: Translate;
  notify: (message: string) => void;
};

export type ThemeTab = "builtIn" | "market" | "saved";

export type RunStatusOperation = (
  key: string,
  operation: () => Promise<DreamSkinStatus>,
  successMessage: string,
) => Promise<boolean>;

export type StatusState = {
  busy: string | null;
  error: string | null;
  loading: boolean;
  resources: DreamSkinResourcesStatus | null;
  status: DreamSkinStatus | null;
  confirmChatGptRestart: (operation: () => Promise<unknown>) => void;
  refresh: () => Promise<void>;
  runStatusOperation: RunStatusOperation;
  setBusy: Dispatch<SetStateAction<string | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setResources: Dispatch<SetStateAction<DreamSkinResourcesStatus | null>>;
};

export type CatalogState = {
  communityError: string | null;
  communityHasMore: boolean;
  communityInitialized: boolean;
  communityLoading: boolean;
  communitySentinelRef: RefObject<HTMLDivElement>;
  communityThemes: DreamSkinCommunityTheme[];
  communityTotal: number | null;
  communityWarning: string | null;
  filteredCommunityThemes: DreamSkinCommunityTheme[];
  filteredMarketThemes: DreamSkinMarketTheme[];
  market: DreamSkinMarketResult | null;
  marketError: string | null;
  marketLoading: boolean;
  marketQuery: string;
  loadCommunityThemes: (reset?: boolean) => Promise<void>;
  refreshMarket: () => Promise<void>;
  refreshThemeMarket: () => void;
  setCommunityThemes: Dispatch<SetStateAction<DreamSkinCommunityTheme[]>>;
  setMarketQuery: Dispatch<SetStateAction<string>>;
};

export type ImportSaveActions = {
  chooseCustomImage: () => Promise<void>;
  importOpen: boolean;
  importOptions: DreamSkinImportOptions;
  saveName: string;
  saveOpen: boolean;
  savedThemes: DreamSkinThemeSummary[];
  setImportOpen: Dispatch<SetStateAction<boolean>>;
  setImportOptions: Dispatch<SetStateAction<DreamSkinImportOptions>>;
  setSaveName: Dispatch<SetStateAction<string>>;
  setSaveOpen: Dispatch<SetStateAction<boolean>>;
  submitImport: () => Promise<void>;
  submitSave: () => Promise<void>;
};

export type ThemeActions = {
  applyTheme: (themeId: string) => void;
  changeAppearance: (appearance: DreamSkinAppearance) => void;
  changeOverlayOpacity: (opacity: number) => void;
  deleteSavedThemes: (themeIds: string[]) => Promise<boolean>;
  installAndApplyCommunityTheme: (theme: DreamSkinCommunityTheme) => void;
  installAndApplyMarketTheme: (theme: DreamSkinMarketTheme) => void;
};

export type SavedThemeLibrary = {
  query: string;
  selectedThemeIds: string[];
  deleteSelectedThemes: () => Promise<void>;
  setQuery: Dispatch<SetStateAction<string>>;
  toggleTheme: (themeId: string, selected: boolean) => void;
};
