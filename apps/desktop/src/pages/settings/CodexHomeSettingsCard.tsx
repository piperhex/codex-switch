import { Button, Dropdown, Input, Switch, Tooltip } from "antd";
import { FolderKey, FolderOpen, Plus, Sparkles, Trash2 } from "lucide-react";
import { DEFAULT_CODEX_HOME_ID } from "../../types";
import type { SettingsPageProps } from "./types";

export function CodexHomeSettingsCard({ settings }: { settings: SettingsPageProps }) {
  const { t } = settings;
  const presetItems = settings.codexHomePresets.map((preset) => ({
    key: preset.id,
    label: `${preset.name} · ${preset.path}`,
    onClick: () => void settings.onAddCodexHomePath(preset.path),
  }));
  return (
    <section className="settings-card codex-home-settings-card">
      <div className="settings-icon"><FolderKey size={23} /></div>
      <div className="settings-card-content codex-home-card-content">
        <div className="settings-card-copy">
          <h3>Codex Home</h3>
          <p>{t("settings.codexHome.description")}</p>
        </div>
        <div className="codex-home-toolbar">
          <Button size="small" icon={<Plus size={14} />} disabled={settings.codexHomeLoading}
            onClick={settings.onAddCodexHome}>
            {t("settings.codexHome.add")}
          </Button>
          <Button size="small" icon={<FolderOpen size={14} />} disabled={settings.codexHomeLoading}
            onClick={settings.onChooseNewCodexHome}>
            {t("settings.codexHome.browse")}
          </Button>
          <Button size="small" disabled={settings.codexHomeLoading || !settings.info?.codexHome}
            onClick={settings.onOpenCodexHome}>
            {t("settings.openFolder")}
          </Button>
          {presetItems.length > 0 && (
            <Dropdown menu={{ items: presetItems }} trigger={["click"]}>
              <Button size="small" icon={<Sparkles size={14} />} disabled={settings.codexHomeLoading}>
                {t("settings.codexHome.presets")}
              </Button>
            </Dropdown>
          )}
        </div>
        <div className="codex-home-list" aria-busy={settings.codexHomeLoading}>
          {settings.codexHomes.map((home) => (
            <div
              className={`codex-home-row${home.id === DEFAULT_CODEX_HOME_ID ? " is-default" : ""}`}
              key={home.id}
            >
              <Switch
                size="small"
                checked={home.enabled}
                disabled={!home.path.trim()}
                loading={settings.codexHomeLoading}
                aria-label={t("settings.codexHome.enabled")}
                onChange={(enabled) => settings.onCodexHomeEnabledChange(home.id, enabled)}
              />
              {home.id === DEFAULT_CODEX_HOME_ID ? <code>{home.path}</code> : (
                <>
                  <Input
                    size="small"
                    value={home.path}
                    disabled={settings.codexHomeLoading}
                    placeholder={t("settings.codexHome.pathPlaceholder")}
                    onChange={(event) => settings.onCodexHomePathChange(home.id, event.target.value)}
                    onBlur={() => settings.onCommitCodexHomePath(home.id)}
                    onPressEnter={(event) => event.currentTarget.blur()}
                  />
                  <Tooltip title={t("settings.codexHome.chooseFolder")}>
                    <Button
                      size="small"
                      icon={<FolderOpen size={14} />}
                      disabled={settings.codexHomeLoading}
                      aria-label={t("settings.codexHome.chooseFolder")}
                      onClick={() => settings.onChooseCodexHome(home.id)}
                    />
                  </Tooltip>
                  <Tooltip title={t("settings.codexHome.remove")}>
                    <Button
                      danger
                      size="small"
                      type="text"
                      icon={<Trash2 size={14} />}
                      disabled={settings.codexHomeLoading}
                      aria-label={t("settings.codexHome.remove")}
                      onClick={() => settings.onRemoveCodexHome(home.id)}
                    />
                  </Tooltip>
                </>
              )}
            </div>
          ))}
          {!settings.codexHomes.length && (
            <div className="codex-home-default-row">
              <span>{t("settings.codexHome.defaultActive")}</span>
              <code>{settings.info?.codexHome ?? t("settings.loading")}</code>
            </div>
          )}
        </div>
        <p className="codex-home-hint">{t("settings.codexHome.enabledHint")}</p>
      </div>
    </section>
  );
}
