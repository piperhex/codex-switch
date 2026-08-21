import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Space } from "antd";
import {
  Network, RefreshCw, Server,
} from "lucide-react";
import type { AccountDisplayMode } from "../hooks/useAccountDisplayMode";
import type { Language, Translate } from "../i18n";
import type {
  Account, AggregateApi, AggregateApiInput, ImageModelTarget, ImageRouteKind, LocalProxyStatus,
  Provider, ProviderInput,
} from "../types";
import { isAntigravityProvider } from "../utils/antigravityProvider";
import { isClaudeCodeProvider } from "../utils/claudeCodeProvider";
import { isGrokProvider } from "../utils/grokProvider";
import { findProviderPreset, type ProviderPresetId } from "../utils/providerCatalog";
import { AntigravityProviderModal } from "./providers/AntigravityProviderModal";
import { CatalogProviderModal } from "./providers/CatalogProviderModal";
import { ClaudeCodeProviderModal } from "./providers/ClaudeCodeProviderModal";
import { GrokProviderModal } from "./providers/GrokProviderModal";
import { ProviderModal } from "./providers/ProviderModal";
import { ProviderPresetModal } from "./providers/ProviderPresetModal";
import { DeepSeekProviderModal, OpenAiProviderModal } from "./providers/ProviderPresetModals";
import { ProviderCardView, ProviderTableView } from "./providers/ProviderViews";
import { ProviderAddMenu } from "./providers/ProviderAddMenu";
import { ProviderGroupToolbar } from "./providers/ProviderGroupControls";
import { ProviderGroupManager } from "./providers/ProviderGroupManager";
import { AggregateApiManager } from "./providers/AggregateApiManager";
import { AggregateApiOverview } from "./providers/AggregateApiOverview";
import { useProviderTokenUsage } from "./providers/useProviderTokenUsage";

const AGGREGATE_RUNTIME_REFRESH_MS = 2_000;

interface ProvidersPageProps {
  providers: Provider[];
  aggregateApis: AggregateApi[];
  providerGroups: string[];
  accounts: Account[];
  active: boolean;
  loading: boolean;
  busyProviderId: string | null;
  saving: boolean;
  localProxy: LocalProxyStatus | null;
  proxyBusy: boolean;
  proxyStartDisabledReason?: string;
  onStartProxy: () => void;
  onSave: (provider: ProviderInput) => Promise<Provider | null>;
  onSaveAggregateApi: (aggregate: AggregateApiInput) => Promise<AggregateApi | null>;
  onRefreshAggregateApis: () => Promise<void>;
  onSwitchAggregateApi: (id: string) => Promise<boolean>;
  onDeleteAggregateApi: (id: string) => void;
  onSwitch: (id: string) => void;
  onSwitchGroup: (group: string) => void;
  onDeactivate: (id: string) => void;
  onSwitchModel: (id: string, model: string) => void;
  onModelControlChange: (id: string, controlledByCodex: boolean) => void;
  onGroupChange: (id: string, group: string) => void;
  onGroupChangeMany: (ids: string[], group: string) => Promise<string[]>;
  onProviderGroupsChange: (groups: string[]) => Promise<void>;
  onAutoSwitchChange: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onDeleteMany: (ids: string[]) => Promise<string[]>;
  onImageModelChange: (routeKind: ImageRouteKind, target: ImageModelTarget | null) => void;
  displayMode: AccountDisplayMode;
  privacyMode: boolean;
  tokenUsageRefreshSeconds: number;
  language: Language;
  t: Translate;
}
export function ProvidersPage({
  providers,
  aggregateApis,
  providerGroups,
  accounts,
  active,
  loading,
  busyProviderId,
  saving,
  localProxy,
  proxyBusy,
  proxyStartDisabledReason,
  onStartProxy,
  onSave,
  onSaveAggregateApi,
  onRefreshAggregateApis,
  onSwitchAggregateApi,
  onDeleteAggregateApi,
  onSwitch,
  onSwitchGroup,
  onDeactivate,
  onSwitchModel,
  onModelControlChange,
  onGroupChange,
  onGroupChangeMany,
  onProviderGroupsChange,
  onAutoSwitchChange,
  onDelete,
  onDeleteMany,
  onImageModelChange,
  displayMode,
  privacyMode,
  tokenUsageRefreshSeconds,
  language,
  t,
}: ProvidersPageProps) {
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showOpenAiModal, setShowOpenAiModal] = useState(false);
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [showDeepSeekModal, setShowDeepSeekModal] = useState(false);
  const [showAntigravityModal, setShowAntigravityModal] = useState(false);
  const [showGrokModal, setShowGrokModal] = useState(false);
  const [showClaudeCodeModal, setShowClaudeCodeModal] = useState(false);
  const [showAggregateManager, setShowAggregateManager] = useState(false);
  const [catalogPresetId, setCatalogPresetId] = useState<ProviderPresetId | null>(null);
  const [selectedProviderIds, setSelectedProviderIds] = useState<string[]>([]);
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);
  const [topbarHost, setTopbarHost] = useState<HTMLElement | null>(null);
  const proxyRunning = Boolean(localProxy?.running);
  const activeAggregateId = aggregateApis.find((aggregate) => aggregate.active)?.id;
  const groups = [...new Set([
    ...providerGroups,
    ...providers.filter((provider) => provider.kind === "custom").map((provider) => provider.group),
  ].filter(Boolean))];

  useEffect(() => {
    setTopbarHost(active ? document.getElementById("provider-topbar-actions") : null);
  }, [active]);

  useEffect(() => {
    const providerIds = new Set(providers.map((provider) => provider.id));
    setSelectedProviderIds((current) => current.filter((id) => providerIds.has(id)));
  }, [providers]);

  useEffect(() => {
    if (!active || !activeAggregateId) return undefined;
    let refreshRunning = false;
    const refreshCounts = async () => {
      if (refreshRunning) return;
      refreshRunning = true;
      try {
        await onRefreshAggregateApis();
      } catch {
        // Runtime statistics are best-effort and the next interval retries automatically.
      } finally {
        refreshRunning = false;
      }
    };
    void refreshCounts();
    const timer = window.setInterval(() => void refreshCounts(), AGGREGATE_RUNTIME_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [active, activeAggregateId, onRefreshAggregateApis]);

  const usageForProvider = useProviderTokenUsage(tokenUsageRefreshSeconds);

  const openCreate = () => {
    setEditingProvider(null);
    setShowModal(true);
  };
  const openCreateOpenAi = () => {
    setEditingProvider(null);
    setShowOpenAiModal(true);
  };
  const openDeepSeekPreset = () => {
    setEditingProvider(null);
    setShowPresetModal(false);
    setShowDeepSeekModal(true);
  };
  const openAntigravityPreset = () => {
    setEditingProvider(null);
    setShowPresetModal(false);
    setShowAntigravityModal(true);
  };
  const openGrokPreset = () => {
    setEditingProvider(null);
    setShowPresetModal(false);
    setShowGrokModal(true);
  };
  const openClaudeCodePreset = () => {
    setEditingProvider(null);
    setShowPresetModal(false);
    setShowClaudeCodeModal(true);
  };
  const openCatalogPreset = (presetId: ProviderPresetId) => {
    setEditingProvider(null);
    setShowPresetModal(false);
    setCatalogPresetId(presetId);
  };
  const openEdit = (provider: Provider) => {
    setEditingProvider(provider);
    const catalogPreset = findProviderPreset(provider);
    if (provider.kind === "openai") {
      setShowOpenAiModal(true);
    } else if (isAntigravityProvider(provider)) {
      setShowAntigravityModal(true);
    } else if (isGrokProvider(provider)) {
      setShowGrokModal(true);
    } else if (isClaudeCodeProvider(provider)) {
      setShowClaudeCodeModal(true);
    } else if (catalogPreset) {
      setCatalogPresetId(catalogPreset.id);
    } else if (provider.balancePlatform === "deepSeek") {
      setShowDeepSeekModal(true);
    } else {
      setShowModal(true);
    }
  };

  if (loading) return <div className="loading-state"><RefreshCw className="spin" />{t("providers.loading")}</div>;

  const providerViewProps = {
    providers,
    providerGroups: groups,
    accounts,
    busyProviderId,
    proxyRunning,
    proxyBusy,
    proxyStartDisabledReason,
    language,
    usageForProvider,
    onSwitch,
    onDeactivate,
    onStartProxy,
    onSwitchModel,
    onModelControlChange,
    onGroupChange,
    onGroupChangeMany,
    onAutoSwitchChange,
    onDelete,
    onEdit: openEdit,
    imageInputTarget: localProxy?.imageInputTarget ?? null,
    imageOutputTarget: localProxy?.imageOutputTarget ?? null,
    imageModelBusy: proxyBusy,
    onImageModelChange,
    privacyMode,
    aggregateConversationCounts: aggregateApis.find((aggregate) => aggregate.active)
      ?.memberConversationCounts ?? {},
    t,
  };

  return (
    <>
      {topbarHost && createPortal(
        <Space size={6}>
          <ProviderAddMenu onAddPreset={() => setShowPresetModal(true)} onAddOpenAi={openCreateOpenAi}
            onAddProvider={openCreate} t={t} />
          <Button className="provider-topbar-button" icon={<Network size={14} />}
            onClick={() => setShowAggregateManager(true)}>
            {t("providers.aggregate.manage")}
          </Button>
          <ProviderGroupToolbar providers={providers} busyProviderId={busyProviderId}
            proxyRunning={proxyRunning} onSwitchGroup={onSwitchGroup} t={t} />
          <ProviderGroupManager groups={groups} providers={providers} busy={Boolean(busyProviderId)}
            onChangeMany={onGroupChangeMany} onGroupsChange={onProviderGroupsChange} t={t} />
        </Space>,
        topbarHost,
      )}
      <div className="provider-page">

      <AggregateApiOverview aggregates={aggregateApis} providers={providers}
        busyId={busyProviderId} proxyRunning={proxyRunning}
        onManage={() => setShowAggregateManager(true)} onSwitch={onSwitchAggregateApi}
        onDeactivate={onDeactivate} t={t} />

      {providers.length ? displayMode === "table"
        ? <ProviderTableView {...providerViewProps} onDeleteMany={onDeleteMany}
          selectedProviderIds={selectedProviderIds} setSelectedProviderIds={setSelectedProviderIds}
          bulkDeleteBusy={bulkDeleteBusy} setBulkDeleteBusy={setBulkDeleteBusy} />
        : <ProviderCardView {...providerViewProps} /> : (
        <div className="provider-empty">
          <Server size={24} />
          <strong>{t("providers.empty.title")}</strong>
          <Space size={8}>
            <ProviderAddMenu onAddPreset={() => setShowPresetModal(true)} onAddOpenAi={openCreateOpenAi}
              onAddProvider={openCreate} t={t} />
            <Button icon={<Network size={14} />} onClick={() => setShowAggregateManager(true)}>
              {t("providers.aggregate.manage")}
            </Button>
          </Space>
        </div>
      )}

      {showModal && <ProviderModal provider={editingProvider} saving={saving}
        onClose={() => setShowModal(false)} onSave={onSave} t={t} />}
      {showOpenAiModal && <OpenAiProviderModal provider={editingProvider} saving={saving}
        onClose={() => setShowOpenAiModal(false)} onSave={onSave} t={t} />}
      {showPresetModal && <ProviderPresetModal onClose={() => setShowPresetModal(false)}
        onSelectAntigravity={openAntigravityPreset} onSelectClaudeCode={openClaudeCodePreset}
        onSelectDeepSeek={openDeepSeekPreset} onSelectGrok={openGrokPreset}
        onSelectCatalog={openCatalogPreset} t={t} />}
      {catalogPresetId && <CatalogProviderModal presetId={catalogPresetId}
        provider={editingProvider} saving={saving} onClose={() => setCatalogPresetId(null)}
        onSave={onSave} t={t} />}
      {showDeepSeekModal && <DeepSeekProviderModal provider={editingProvider} saving={saving}
        onClose={() => setShowDeepSeekModal(false)} onSave={onSave} t={t} />}
      {showAntigravityModal && <AntigravityProviderModal provider={editingProvider} saving={saving}
        onClose={() => setShowAntigravityModal(false)} onSave={onSave} t={t} />}
      {showGrokModal && <GrokProviderModal provider={editingProvider} saving={saving}
        onClose={() => setShowGrokModal(false)} onSave={onSave} t={t} />}
      {showClaudeCodeModal && <ClaudeCodeProviderModal provider={editingProvider} saving={saving}
        onClose={() => setShowClaudeCodeModal(false)} onSave={onSave} t={t} />}
      <AggregateApiManager open={showAggregateManager} aggregates={aggregateApis}
        providers={providers} saving={saving} busyId={busyProviderId} proxyRunning={proxyRunning}
        onClose={() => setShowAggregateManager(false)} onSave={onSaveAggregateApi}
        onSwitch={onSwitchAggregateApi} onDeactivate={onDeactivate}
        onDelete={onDeleteAggregateApi} t={t} />
      </div>
    </>
  );
}
