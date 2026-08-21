import { Popconfirm, Switch } from "antd";
import { Download, LoaderCircle, RefreshCw, Trash2 } from "lucide-react";
import type { MouseEvent } from "react";
import type { SkillMarketItem } from "../../../types";
import type { SkillInstallButtonProps } from "../types";

function installIcon(skill: SkillMarketItem, busy: boolean) {
  if (busy) return <LoaderCircle className="spin" size={16} />;
  if (skill.installedVersion) return <RefreshCw size={16} />;
  return <Download size={16} />;
}

function installLabel({ busyAction, skill, t }: SkillInstallButtonProps) {
  if (busyAction?.skillId === skill.id && busyAction.action === "install") return t("skills.installing");
  if (skill.installedVersion) {
    return t("skills.update", { version: skill.installedVersion });
  }
  return t("skills.install");
}

function stopCardOpen(event: MouseEvent<HTMLElement>) {
  event.stopPropagation();
}

function InstalledActions(props: SkillInstallButtonProps) {
  const { busyAction, onInstall, onRemove, onSetEnabled, skill, t } = props;
  const busy = busyAction?.skillId === skill.id;
  const removing = busy && busyAction.action === "remove";
  return (
    <div className="community-skill-actions" onClick={stopCardOpen}>
      <div className="community-skill-toggle">
        <Switch
          size="small"
          checked={skill.enabled}
          disabled={busy}
          loading={busy && busyAction.action === "toggle"}
          onChange={(enabled) => void onSetEnabled(skill, enabled)}
        />
        <span>{t(skill.enabled ? "skills.enabled" : "skills.disabled")}</span>
      </div>
      <Popconfirm
        title={<span className="compact-confirm-copy">{t("skills.delete.confirmTitle", { name: skill.title })}</span>}
        description={<span className="compact-confirm-copy">{t("skills.delete.confirmDescription")}</span>}
        okText={t("skills.delete.action")}
        cancelText={t("skills.cancel")}
        okButtonProps={{ danger: true }}
        onConfirm={() => void onRemove(skill)}
      >
        <button type="button" className="skill-install-button uninstall" disabled={busy}>
          {removing ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}
          {t(removing ? "skills.deleting" : "skills.delete.action")}
        </button>
      </Popconfirm>
      {!skill.installed && (
        <button
          type="button"
          className="skill-install-button community-skill-update"
          disabled={busy}
          onClick={() => void onInstall(skill)}
        >
          {installIcon(skill, busy && busyAction?.action === "install")}
          {installLabel(props)}
        </button>
      )}
    </div>
  );
}

export function SkillInstallButton(props: SkillInstallButtonProps) {
  const { busyAction, onInstall, skill } = props;
  if (skill.installedVersion) return <InstalledActions {...props} />;
  const busy = busyAction?.skillId === skill.id;
  return (
    <button
      type="button"
      className="skill-install-button"
      disabled={busy}
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
