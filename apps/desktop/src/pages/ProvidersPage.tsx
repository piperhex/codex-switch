import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Space } from "antd";
import {
  Bot, Plus, RefreshCw, Server, Sparkles, WalletCards,
} from "lucide-react";
import type { AccountDisplayMode } from "../hooks/useAccountDisplayMode";
import type { Language, Translate } from "../i18n";
import type { LocalProxyStatus, Provider, ProviderInput } from "../types";
import { ProviderModal } from "./providers/ProviderModal";
import { DeepSeekProviderModal, OpenAiProviderModal, ProviderPresetModal } from "./providers/ProviderPresetModals";
import { RelayStationModal } from "./providers/RelayStationModal";
import { ProviderCardView, ProviderTableView } from "./providers/ProviderViews";
import { useProviderTokenUsage } from "./providers/useProviderTokenUsage";

interface ProvidersPageProps {
  providers: Provider[];
  active: boolean;
  loading: boolean;
  busyProviderId: string | null;
  saving: boolean;
  localProxy: LocalProxyStatus | null;
  onSave: (provider: ProviderInput) => Promise<Provider | null>;
  onSwitch: (id: string) => void;
  onSwitchModel: (id: string, model: string) => void;
  onModelControlChange: (id: string, controlledByCodex: boolean) => void;
  onAutoSwitchChange: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onDeleteMany: (ids: string[]) => Promise<string[]>;
  displayMode: AccountDisplayMode;
  tokenUsageRefreshSeconds: number;
  language: Language;
  t: Translate;
}
export function ProvidersPage({
  providers,
  active,
  loading,
  busyProviderId,
  saving,
  localProxy,
  onSave,
  onSwitch,
  onSwitchModel,
  onModelControlChange,
  onAutoSwitchChange,
  onDelete,
  onDeleteMany,
  displayMode,
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
  const openEdit = (provider: Provider) => {
    setEditingProvider(provider);
    if (provider.kind === "openai") {
      setShowOpenAiModal(true);
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
    language,
    usageForProvider,
    onSwitch,
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
        <>
          <Button type="primary" icon={<Sparkles size={14} />} onClick={() => setShowPresetModal(true)}>
            {t("providers.action.addPreset")}
          </Button>
          <Button type="primary" icon={<Bot size={14} />} onClick={openCreateOpenAi}>
            {t("providers.action.addOpenAi")}
          </Button>
          <Button icon={<Plus size={14} />} onClick={openCreate}>
            {t("providers.action.add")}
          </Button>
          <Button icon={<WalletCards size={14} />} onClick={() => setShowRelayModal(true)}>
            {t("providers.action.addRelay")}
          </Button>
        </>,
        topbarHost,
      )}
      <div className="provider-page">

      {providers.length ? displayMode === "table"
        ? <ProviderTableView {...providerViewProps} onDeleteMany={onDeleteMany}
          selectedProviderIds={selectedProviderIds} setSelectedProviderIds={setSelectedProviderIds}
          bulkDeleteBusy={bulkDeleteBusy} setBulkDeleteBusy={setBulkDeleteBusy} />
        : <ProviderCardView {...providerViewProps} /> : (
        <div className="provider-empty">
          <Server size={24} />
          <strong>{t("providers.empty.title")}</strong>
          <Space size={8}>
            <Button type="primary" icon={<Sparkles size={14} />} onClick={() => setShowPresetModal(true)}>
              {t("providers.action.addPreset")}
            </Button>
            <Button type="primary" icon={<Bot size={14} />} onClick={openCreateOpenAi}>
              {t("providers.action.addOpenAi")}
            </Button>
            <Button icon={<Plus size={14} />} onClick={openCreate}>{t("providers.action.add")}</Button>
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
        onSelectDeepSeek={openDeepSeekPreset} t={t} />}
      {showDeepSeekModal && <DeepSeekProviderModal provider={editingProvider} saving={saving}
        onClose={() => setShowDeepSeekModal(false)} onSave={onSave} t={t} />}
      </div>
    </>
  );
}
