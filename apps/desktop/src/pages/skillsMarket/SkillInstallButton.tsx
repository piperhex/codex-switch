import { Check, Download, LoaderCircle, RefreshCw } from "lucide-react";
import type { SkillMarketItem } from "../../types";
import type { SkillInstallButtonProps } from "./types";

function installIcon(skill: SkillMarketItem, busy: boolean) {
  if (busy) return <LoaderCircle className="spin" size={16} />;
  if (skill.installed) return <Check size={16} />;
  if (skill.installedVersion) return <RefreshCw size={16} />;
  return <Download size={16} />;
}

function installLabel({ busy, skill, t }: SkillInstallButtonProps) {
  if (busy) return t("skills.installing");
  if (skill.installed) return t("skills.installed");
  if (skill.installedVersion) {
    return t("skills.update", { version: skill.installedVersion });
  }
  return t("skills.install");
}

export function SkillInstallButton(props: SkillInstallButtonProps) {
  const { busy, onInstall, skill } = props;
  return (
    <button
      type="button"
      className={`skill-install-button${skill.installed ? " installed" : ""}`}
      disabled={busy || skill.installed}
      onClick={(event) => {
        event.stopPropagation();
        void onInstall(skill);
      }}
    >
      {installIcon(skill, busy)}
      {installLabel(props)}
    </button>
  );
}
