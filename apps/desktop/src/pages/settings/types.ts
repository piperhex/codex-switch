import type { AccountDisplayMode } from "../../hooks/useAccountDisplayMode";
import type { Language, Translate } from "../../i18n";
import type {
  AppInfo,
  BubbleResetDisplay,
  BubbleStyle,
  NetworkProxySettings,
} from "../../types";

export interface SettingsPageProps {
  info: AppInfo | null;
  launchAtStartupEnabled: boolean;
  launchAtStartupLoading: boolean;
  onLaunchAtStartupChange: (enabled: boolean) => void;
  autoRefreshEnabled: boolean;
  autoRefreshSeconds: number;
  onEnabledChange: (enabled: boolean) => void;
  onSecondsChange: (value: number | string | null) => void;
  currentAutoRefreshTarget: string | null;
  accountAutoRefreshEnabled: boolean;
  accountAutoRefreshSeconds: number;
  onAccountAutoRefreshEnabledChange: (enabled: boolean) => void;
  onAccountAutoRefreshSecondsChange: (value: number | string | null) => void;
  themeColor: string;
  themeColorLoading: boolean;
  onThemeColorChange: (color: string) => void;
  cloudBaseUrl: string;
  cloudBaseUrlLoading: boolean;
  cloudAuthenticated: boolean;
  showCustomCloudServer: boolean;
  onCloudBaseUrlSave: (baseUrl: string) => Promise<void> | void;
  totpCloudSyncEnabled: boolean;
  totpCloudSyncLoading: boolean;
  onTotpCloudSyncChange: (enabled: boolean) => void;
  floatingBubbleEnabled: boolean;
  floatingBubbleLoading: boolean;
  onFloatingBubbleChange: (enabled: boolean) => void;
  bubbleResetDisplay: BubbleResetDisplay;
  bubbleResetDisplayLoading: boolean;
  onBubbleResetDisplayChange: (display: BubbleResetDisplay) => void;
  bubbleStyle: BubbleStyle;
  bubbleStyleLoading: boolean;
  onBubbleStyleChange: (style: BubbleStyle) => void;
  privacyModeEnabled: boolean;
  hideAccountNotes: boolean;
  privacyModeLoading: boolean;
  onPrivacyModeChange: (enabled: boolean) => void;
  onHideAccountNotesChange: (enabled: boolean) => void;
  accountDisplayMode: AccountDisplayMode;
  onAccountDisplayModeChange: (mode: AccountDisplayMode) => void;
  tokenUsageWeeks: number;
  tokenUsageRefreshSeconds: number;
  tokenUsagePreferencesLoading: boolean;
  autoDisableStatusCodes: number[];
  autoDisableStatusCodesLoading: boolean;
  onAutoDisableStatusCodesChange: (statusCodes: number[]) => Promise<void> | void;
  showUsageNetworkErrors: boolean;
  showUsageNetworkErrorsLoading: boolean;
  onShowUsageNetworkErrorsChange: (enabled: boolean) => Promise<void> | void;
  webProxyPort?: number | null;
  webProxyPortLoading?: boolean;
  onWebProxyPortChange?: (port: number | null) => void;
  onOpenWebVersion?: (url: string) => void;
  networkProxy: NetworkProxySettings;
  networkProxyLoading: boolean;
  onNetworkProxySave: (settings: NetworkProxySettings) => Promise<boolean>;
  onTokenUsageWeeksChange: (value: number | string | null) => void;
  onTokenUsageRefreshSecondsChange: (value: number | string | null) => void;
  onOpenCodexHome: () => void;
  onOpenAccountStore: () => void;
  onExportLogs: () => void;
  exportingLogs: boolean;
  language: Language;
  onLanguageChange: (language: Language) => void;
  t: Translate;
}
