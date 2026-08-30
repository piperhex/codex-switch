import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Edit3, LoaderCircle, Plus, RefreshCw, Trash2, X } from "lucide-react";
import {
  fetchPromptPlugins,
  installPromptPlugin,
  publishPromptPlugin,
  removePromptPlugin,
  setPromptPluginEnabled,
} from "../../api/backend";
import type { PromptPluginItem, PromptPluginType } from "../../types";
import type { SkillsMarketPageProps, SkillsMarketNavigationProps } from "../skillsMarket/types";
import { SkillsMarketToolbar } from "../skillsMarket/SkillsMarketToolbar";
import styles from "./index.module.less";
import { isPromptPluginUpdateAvailable, nextPromptPluginVersion } from "./promptPluginUtils";

type Props = SkillsMarketPageProps & SkillsMarketNavigationProps;
type PromptPluginAction = "install" | "update" | "remove" | "toggle";

function typeLabel(type: PromptPluginType, t: Props["t"]) {
  return t(type === "filter" ? "skills.prompt.filter" : "skills.prompt.injection");
}

interface PublishModalProps {
  editing: PromptPluginItem | null;
  onClose: () => void;
  onPublished: () => Promise<void>;
  t: Props["t"];
}

function PublishModal({ editing, onClose, onPublished, t }: PublishModalProps) {
  const [name, setName] = useState(editing?.name ?? "");
  const [version, setVersion] = useState(nextPromptPluginVersion(editing?.version));
  const [type, setType] = useState<PromptPluginType>(editing?.type ?? "injection");
  const [text, setText] = useState(editing?.text ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim() || !version.trim() || !text.trim()) {
      setError(t("skills.prompt.required"));
      return;
    }
    if (type === "filter" && text.trim().length > 500) {
      setError(t("skills.prompt.filterTooLong"));
      return;
    }
    setBusy(true);
    try {
      await publishPromptPlugin({ pluginId: editing?.id, name, version, type, text });
      await onPublished();
      onClose();
    } catch (caught) {
      setError(String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className={`modal ${styles.modal}`}
        role="dialog"
        aria-modal="true"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <button type="button" className="modal-close" onClick={onClose} aria-label={t("skills.publish.close")}>
          <X size={18} />
        </button>
        <h2>{editing ? t("skills.prompt.updateTitle") : t("skills.prompt.publishTitle")}</h2>
        <label>
          {t("skills.prompt.name")}
          <input value={name} disabled={busy} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          {t("skills.prompt.version")}
          <input value={version} disabled={busy} onChange={(event) => setVersion(event.target.value)} />
        </label>
        <div className={styles.typeTabs}>
          {(["injection", "filter"] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={type === item ? styles.active : ""}
              disabled={busy}
              onClick={() => setType(item)}
            >
              {typeLabel(item, t)}
            </button>
          ))}
        </div>
        <label className={styles.textField}>
          {t("skills.prompt.text")}
          <textarea
            rows={8}
            maxLength={type === "filter" ? 500 : 5000}
            value={text}
            disabled={busy}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        {error && <p className="feedback-error">{error}</p>}
        <div className="feedback-actions">
          <button type="button" className="note-cancel-button" disabled={busy} onClick={onClose}>
            {t("skills.cancel")}
          </button>
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />}
            {editing ? t("skills.edit") : t("skills.prompt.publish")}
          </button>
        </div>
      </form>
    </div>
  );
}

export function PromptPluginsMarket({
  active,
  activeTab,
  authenticated,
  currentUserId,
  notify,
  onLogin,
  onTabChange,
  t,
}: Props) {
  const [items, setItems] = useState<PromptPluginItem[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [editing, setEditing] = useState<PromptPluginItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await fetchPromptPlugins());
      setError(null);
    } catch (caught) {
      setError(String(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return items.filter((item) => !needle || `${item.name}\n${item.text}`.toLocaleLowerCase().includes(needle));
  }, [items, query]);

  const run = async (item: PromptPluginItem, action: PromptPluginAction) => {
    setBusy(item.id);
    try {
      if (action === "install" || action === "update") await installPromptPlugin(item.id, item.version);
      else if (action === "remove") await removePromptPlugin(item.id);
      else await setPromptPluginEnabled(item.id, !item.enabled);
      const toastKey = action === "update"
        ? "skills.prompt.toast.updated"
        : action === "remove"
          ? "skills.prompt.toast.remove"
          : action === "toggle"
            ? "skills.prompt.toast.toggle"
            : "skills.prompt.toast.install";
      notify(t(toastKey));
      await load();
    } catch (caught) {
      setError(String(caught));
    } finally {
      setBusy(null);
    }
  };

  const openPublish = () => {
    if (authenticated) setPublishing(true);
    else onLogin();
  };

  return (
    <div className="skills-market-page">
      <SkillsMarketToolbar
        active={active}
        activeTab={activeTab}
        loading={loading}
        onPublish={openPublish}
        onQueryChange={setQuery}
        onRefresh={() => void load()}
        onTabChange={onTabChange}
        query={query}
        t={t}
      />
      {error && <div className="skills-market-error" role="alert">{error}</div>}
      {loading && !items.length ? (
        <div className="skills-market-state"><LoaderCircle className="spin" size={22} />{t("skills.prompt.loading")}</div>
      ) : !filtered.length ? (
        <div className="skills-market-state">{t("skills.prompt.empty")}</div>
      ) : (
        <div className={styles.grid}>
          {filtered.map((item) => {
            const isPublisher = Boolean(authenticated && currentUserId && item.uploaderId === currentUserId);
            const updateAvailable = isPromptPluginUpdateAvailable(item.installedVersion, item.version);
            const itemBusy = busy === item.id;
            return (
              <article className={styles.card} key={item.id}>
                <div className={styles.badge}>{typeLabel(item.type, t)}</div>
                <div className={styles.titleRow}>
                  <h3>{item.name}</h3>
                  <small>v{item.version}</small>
                  {isPublisher && (
                    <button
                      type="button"
                      className={styles.editButton}
                      aria-label={t("skills.edit")}
                      onClick={() => setEditing(item)}
                    >
                      <Edit3 size={15} />
                    </button>
                  )}
                </div>
                <p>{item.text}</p>
                <div className={styles.meta}>
                  <span><Download size={13} />{item.installCount.toLocaleString()}</span>
                  {isPublisher && <span>{t("skills.publisher")}</span>}
                </div>
                <div className={styles.actions}>
                  {item.installed && (
                    <button type="button" disabled={itemBusy} onClick={() => void run(item, "toggle")}>
                      {item.enabled ? t("skills.prompt.disable") : t("skills.prompt.enable")}
                    </button>
                  )}
                  {updateAvailable && (
                    <button type="button" disabled={itemBusy} onClick={() => void run(item, "update")}>
                      {itemBusy ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}
                      {t("skills.prompt.update", { version: item.version })}
                    </button>
                  )}
                  {item.installedVersion && (
                    <button type="button" disabled={itemBusy} onClick={() => void run(item, "remove")}>
                      {itemBusy ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />}
                      {t("skills.prompt.uninstall")}
                    </button>
                  )}
                  {!item.installedVersion && (
                    <button type="button" disabled={itemBusy} onClick={() => void run(item, "install")}>
                      {itemBusy ? <LoaderCircle className="spin" size={14} /> : <Plus size={14} />}
                      {t("skills.prompt.install")}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {(publishing || editing) && (
        <PublishModal
          editing={editing}
          onClose={() => {
            setPublishing(false);
            setEditing(null);
          }}
          onPublished={async () => {
            notify(editing ? t("skills.prompt.toast.updated") : t("skills.prompt.toast.published"));
            await load();
          }}
          t={t}
        />
      )}
    </div>
  );
}
