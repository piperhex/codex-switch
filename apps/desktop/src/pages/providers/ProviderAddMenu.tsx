import { useState } from "react";
import { Button, Dropdown } from "antd";
import type { MenuProps } from "antd";
import { Bot, Plus, Sparkles } from "lucide-react";
import type { Translate } from "../../i18n";

interface ProviderAddMenuProps {
  onAddPreset: () => void;
  onAddOpenAi: () => void;
  onAddProvider: () => void;
  t: Translate;
}

export function ProviderAddMenu({
  onAddPreset,
  onAddOpenAi,
  onAddProvider,
  t,
}: ProviderAddMenuProps) {
  const [open, setOpen] = useState(false);
  const items: MenuProps["items"] = [
    { key: "preset", icon: <Sparkles size={14} />, label: t("providers.action.addPreset") },
    { key: "openai", icon: <Bot size={14} />, label: t("providers.action.addOpenAi") },
    { key: "provider", icon: <Plus size={14} />, label: t("providers.action.add") },
  ];

  const handleSelect: MenuProps["onClick"] = ({ key }) => {
    const actions: Record<string, () => void> = {
      preset: onAddPreset,
      openai: onAddOpenAi,
      provider: onAddProvider,
    };
    setOpen(false);
    actions[key]?.();
  };

  return (
    <Dropdown open={open} onOpenChange={setOpen} trigger={["click"]}
      menu={{ items, onClick: handleSelect }}>
      <Button className="provider-add-menu-button provider-topbar-button" type="primary" icon={<Plus size={14} />}>
        {t("providers.action.addMenu")}
      </Button>
    </Dropdown>
  );
}
