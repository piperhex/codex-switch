import type { ReactNode } from "react";
import { Tag } from "antd";
import {
  Bot,
  Boxes,
  BrainCircuit,
  Cloud,
  Code2,
  Cpu,
  Flame,
  Gem,
  Globe2,
  MonitorCog,
  Moon,
  Orbit,
  Sparkles,
  X,
  Zap,
} from "lucide-react";

import type { Translate, TranslationKey } from "../../i18n";
import {
  PROVIDER_PRESETS,
  type ProviderPresetDescriptor,
  type ProviderPresetId,
  type ProviderPresetTag,
} from "../../utils/providerCatalog";

interface ProviderPresetModalProps {
  onClose: () => void;
  onSelectAntigravity: () => void;
  onSelectClaudeCode: () => void;
  onSelectDeepSeek: () => void;
  onSelectGrok: () => void;
  onSelectCatalog: (id: ProviderPresetId) => void;
  t: Translate;
}

const TAG_KEYS: Record<ProviderPresetTag, TranslationKey> = {
  official: "providers.presets.official",
  local: "providers.presets.localService",
  aggregator: "providers.catalog.tag.aggregator",
  codingPlan: "providers.catalog.tag.codingPlan",
};

const TAG_COLORS: Record<ProviderPresetTag, string> = {
  official: "blue",
  local: "purple",
  aggregator: "cyan",
  codingPlan: "orange",
};

function catalogIcon(id: ProviderPresetId): ReactNode {
  switch (id) {
    case "openRouter": return <Globe2 size={20} />;
    case "kimi": return <Moon size={20} />;
    case "gemini": return <Gem size={20} />;
    case "bailian": return <Cloud size={20} />;
    case "ollama": return <Cpu size={20} />;
    case "lmStudio": return <MonitorCog size={20} />;
    case "glm": return <BrainCircuit size={20} />;
    case "miniMax": return <Boxes size={20} />;
    case "mistral": return <Zap size={20} />;
    case "volcengine": return <Flame size={20} />;
  }
}

function CatalogPresetCard({
  preset,
  onSelect,
  t,
}: {
  preset: ProviderPresetDescriptor;
  onSelect: (id: ProviderPresetId) => void;
  t: Translate;
}) {
  return (
    <button className="provider-preset-card" onClick={() => onSelect(preset.id)}>
      <span className="provider-preset-icon">{catalogIcon(preset.id)}</span>
      <span>
        <strong>{preset.displayName}</strong>
        <small>{t(preset.descriptionKey)}</small>
      </span>
      <Tag color={TAG_COLORS[preset.tag]}>{t(TAG_KEYS[preset.tag])}</Tag>
    </button>
  );
}

function ExistingPresetCards(props: Omit<ProviderPresetModalProps, "onClose" | "onSelectCatalog">) {
  const { onSelectAntigravity, onSelectClaudeCode, onSelectDeepSeek, onSelectGrok, t } = props;
  return <>
    <button className="provider-preset-card" onClick={onSelectAntigravity}>
      <span className="provider-preset-icon"><Orbit size={20} /></span>
      <span>
        <strong>Google Antigravity</strong>
        <small>{t("providers.presets.antigravityDescription")}</small>
      </span>
      <Tag color="purple">{t("providers.presets.localService")}</Tag>
    </button>
    <button className="provider-preset-card" onClick={onSelectDeepSeek}>
      <span className="provider-preset-icon"><Bot size={20} /></span>
      <span>
        <strong>DeepSeek</strong>
        <small>{t("providers.presets.deepSeekDescription")}</small>
      </span>
      <Tag color="blue">{t("providers.presets.official")}</Tag>
    </button>
    <button className="provider-preset-card" onClick={onSelectGrok}>
      <span className="provider-preset-icon"><Zap size={20} /></span>
      <span>
        <strong>Grok</strong>
        <small>{t("providers.presets.grokDescription")}</small>
      </span>
      <Tag color="cyan">{t("providers.presets.official")}</Tag>
    </button>
    <button className="provider-preset-card" onClick={onSelectClaudeCode}>
      <span className="provider-preset-icon"><Code2 size={20} /></span>
      <span>
        <strong>Claude Code</strong>
        <small>{t("providers.presets.claudeCodeDescription")}</small>
      </span>
      <Tag color="orange">{t("providers.presets.official")}</Tag>
    </button>
  </>;
}

export function ProviderPresetModal(props: ProviderPresetModalProps) {
  return (
    <div className="modal-backdrop">
      <div className="modal provider-preset-modal">
        <button className="modal-close" onClick={props.onClose}
          aria-label={props.t("providers.presets.close")}>
          <X size={17} />
        </button>
        <div className="modal-icon"><Sparkles size={22} /></div>
        <h2>{props.t("providers.presets.title")}</h2>
        <p>{props.t("providers.presets.description")}</p>
        <div className="provider-preset-list">
          {PROVIDER_PRESETS.map((preset) => (
            <CatalogPresetCard key={preset.id} preset={preset}
              onSelect={props.onSelectCatalog} t={props.t} />
          ))}
          <ExistingPresetCards {...props} />
        </div>
      </div>
    </div>
  );
}
