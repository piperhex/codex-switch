import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Space } from "antd";
import {
  RefreshCw, Server,
} from "lucide-react";
import type { AccountDisplayMode } from "../hooks/useAccountDisplayMode";
import type { Language, Translate } from "../i18n";
import type { Account, LocalProxyStatus, Provider, ProviderInput } from "../types";
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
import { RelayStationModal } from "./providers/RelayStationModal";
import { ProviderCardView, ProviderTableView } from "./providers/ProviderViews";
import { ProviderAddMenu } from "./providers/ProviderAddMenu";
import { useProviderTokenUsage } from "./providers/useProviderTokenUsage";

interface ProvidersPageProps {
  providers: Provider[];
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
  onSwitch: (id: string) => void;
  onSwitchModel: (id: string, model: string) => void;
  onModelControlChange: (id: string, controlledByCodex: boolean) => void;
  onAutoSwitchChange: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onDeleteMany: (ids: string[]) => Promise<string[]>;
  onImageAccountChange: (accountId: string | null) => void;
  displayMode: AccountDisplayMode;
  privacyMode: boolean;
  tokenUsageRefreshSeconds: number;
  language: Language;
  t: Translate;
}
export function ProvidersPage({
  providers,
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
  onSwitch,
  onSwitchModel,
  onModelControlChange,
  onAutoSwitchChange,
  onDelete,
  onDeleteMany,
  onImageAccountChange,
  displayMode,
  privacyMode,
  tokenUsageRefreshSeconds,
  language,
  t,
}: ProvidersPageProps) {
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showOpenAiModal, setShowOpenAiModal] = useState(false);
  const [showRelayModal, setShowRelayModal] = useState(false);
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [showDeepSeekModal, setShowDeepSeekModal] = useState(false);
  const [showAntigravityModal, setShowAntigravityModal] = useState(false);
  const [showGrokModal, setShowGrokModal] = useState(false);
  const [showClaudeCodeModal, setShowClaudeCodeModal] = useState(false);
  const [catalogPresetId, setCatalogPresetId] = useState<ProviderPresetId | null>(null);
  const [selectedProviderIds, setSelectedProviderIds] = useState<string[]>([]);
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);
  const [topbarHost, setTopbarHost] = useState<HTMLElement | null>(null);
  const proxyRunning = Boolean(localProxy?.running);

  useEffect(() => {
    setTopbarHost(active ? document.getElementById("provider-topbar-actions") : null);
  }, [active]);

  useEffect(() => {
    const providerIds = new Set(providers.map((provider) => provider.id));
    setSelectedProviderIds((current) => current.filter((id) => providerIds.has(id)));
  }, [providers]);

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
    busyProviderId,
    proxyRunning,
    proxyBusy,
    proxyStartDisabledReason,
    language,
    usageForProvider,
    onSwitch,
    onStartProxy,
    onSwitchModel,
    onModelControlChange,
    onAutoSwitchChange,
    onDelete,
    onEdit: openEdit,
    t,
  };

  return (
    <>
      {topbarHost && createPortal(
        <ProviderAddMenu onAddPreset={() => setShowPresetModal(true)} onAddOpenAi={openCreateOpenAi}
          onAddProvider={openCreate} onAddRelay={() => setShowRelayModal(true)} t={t} />,
        topbarHost,
      )}
      <div className="provider-page">

      {providers.length ? displayMode === "table"
        ? <ProviderTableView {...providerViewProps} onDeleteMany={onDeleteMany}
          selectedProviderIds={selectedProviderIds} setSelectedProviderIds={setSelectedProviderIds}
          bulkDeleteBusy={bulkDeleteBusy} setBulkDeleteBusy={setBulkDeleteBusy}
          accounts={accounts} imageGenerationAccountId={localProxy?.imageGenerationAccountId ?? null}
          imageAccountBusy={proxyBusy} onImageAccountChange={onImageAccountChange}
          privacyMode={privacyMode} />
        : <ProviderCardView {...providerViewProps} /> : (
        <div className="provider-empty">
          <Server size={24} />
          <strong>{t("providers.empty.title")}</strong>
          <Space size={8}>
            <ProviderAddMenu onAddPreset={() => setShowPresetModal(true)} onAddOpenAi={openCreateOpenAi}
              onAddProvider={openCreate} onAddRelay={() => setShowRelayModal(true)} t={t} />
          </Space>
        </div>
      )}

      {showModal && <ProviderModal provider={editingProvider} saving={saving}
        onClose={() => setShowModal(false)} onSave={onSave} t={t} />}
      {showOpenAiModal && <OpenAiProviderModal provider={editingProvider} saving={saving}
        onClose={() => setShowOpenAiModal(false)} onSave={onSave} t={t} />}
      {showRelayModal && <RelayStationModal saving={saving}
        onClose={() => setShowRelayModal(false)} onSave={onSave} t={t} />}
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
      </div>
    </>
  );
}
