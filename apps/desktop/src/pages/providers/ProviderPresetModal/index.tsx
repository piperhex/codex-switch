import type { ReactNode } from "react";
import { Tag } from "antd";
import {
  Bot, Boxes, BrainCircuit, Cloud, Code2, Cpu, Flame, Gem, Globe2, MonitorCog, Moon, Orbit,
  Sparkles, X, Zap,
} from "lucide-react";
import type { Translate, TranslationKey } from "../../../i18n";
import {
  PROVIDER_PRESETS, type ProviderPresetDescriptor, type ProviderPresetId, type ProviderPresetTag,
} from "../../../utils/providerCatalog";
import styles from "./index.module.less";

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
  official: "providers.presets.official", local: "providers.presets.localService",
  aggregator: "providers.catalog.tag.aggregator", codingPlan: "providers.catalog.tag.codingPlan",
};
const TAG_COLORS: Record<ProviderPresetTag, string> = {
  official: "blue", local: "purple", aggregator: "cyan", codingPlan: "orange",
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

function CatalogPresetCard({ preset, onSelect, t }: {
  preset: ProviderPresetDescriptor;
  onSelect: (id: ProviderPresetId) => void;
  t: Translate;
}) {
  return <button className={styles.card} onClick={() => onSelect(preset.id)}>
    <span className={styles.icon}>{catalogIcon(preset.id)}</span>
    <span><strong>{preset.displayName}</strong><small>{t(preset.descriptionKey)}</small></span>
    <Tag color={TAG_COLORS[preset.tag]}>{t(TAG_KEYS[preset.tag])}</Tag>
  </button>;
}

function ExistingPresetCards(props: Omit<ProviderPresetModalProps, "onClose" | "onSelectCatalog">) {
  const { onSelectAntigravity, onSelectClaudeCode, onSelectDeepSeek, onSelectGrok, t } = props;
  const cards = [
    ["Google Antigravity", "providers.presets.antigravityDescription", "purple",
      "providers.presets.localService", onSelectAntigravity, <Orbit size={20} />],
    ["DeepSeek", "providers.presets.deepSeekDescription", "blue",
      "providers.presets.official", onSelectDeepSeek, <Bot size={20} />],
    ["Grok", "providers.presets.grokDescription", "cyan",
      "providers.presets.official", onSelectGrok, <Zap size={20} />],
    ["Claude Code", "providers.presets.claudeCodeDescription", "orange",
      "providers.presets.official", onSelectClaudeCode, <Code2 size={20} />],
  ] as const;
  return <>{cards.map(([name, description, color, tagKey, onSelect, icon]) => <button className={styles.card}
    key={name} onClick={onSelect}>
    <span className={styles.icon}>{icon}</span>
    <span><strong>{name}</strong><small>{t(description as TranslationKey)}</small></span>
    <Tag color={color}>{t(tagKey as TranslationKey)}</Tag>
  </button>)}</>;
}

export function ProviderPresetModal(props: ProviderPresetModalProps) {
  return <div className="modal-backdrop">
    <div className={`modal ${styles.modal}`}>
      <button className="modal-close" onClick={props.onClose} aria-label={props.t("providers.presets.close")}>
        <X size={17} />
      </button>
      <div className="modal-icon"><Sparkles size={22} /></div>
      <h2>{props.t("providers.presets.title")}</h2>
      <p>{props.t("providers.presets.description")}</p>
      <div className={styles.list}>
        {PROVIDER_PRESETS.map((preset) => <CatalogPresetCard key={preset.id} preset={preset}
          onSelect={props.onSelectCatalog} t={props.t} />)}
        <ExistingPresetCards {...props} />
      </div>
    </div>
  </div>;
}
