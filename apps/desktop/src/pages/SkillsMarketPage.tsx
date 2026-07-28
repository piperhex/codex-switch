import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  Archive,
  Check,
  Download,
  Edit3,
  FolderOpen,
  ImagePlus,
  LoaderCircle,
  PackageOpen,
  RefreshCw,
  Search,
  Upload,
  X,
} from "lucide-react";
import {
  chooseSkillArchive,
  chooseSkillFolder,
  fetchSkillMarket,
  installMarketSkill,
  publishSkill,
  skillPreviewUrl,
} from "../api/backend";
import type { Translate } from "../i18n";
import type {
  FeedbackImageInput,
  SkillMarketItem,
  SkillPackageSelection,
} from "../types";
import {
  FEEDBACK_IMAGE_TYPES,
  prepareSkillPreview,
} from "../utils/feedbackImages";

interface SkillsMarketPageProps {
  baseUrl?: string | null;
  authenticated: boolean;
  currentUserId?: string | null;
  onLogin: () => void;
  notify: (message: string) => void;
  t: Translate;
}

interface PublishModalProps {
  editing?: SkillMarketItem | null;
  onClose: () => void;
  onPublished: () => Promise<void>;
  t: Translate;
}

interface SkillInstallButtonProps {
  busy: boolean;
  onInstall: (skill: SkillMarketItem) => Promise<void>;
  skill: SkillMarketItem;
  t: Translate;
}

interface SkillDetailModalProps extends SkillInstallButtonProps {
  isPublisher: boolean;
  onClose: () => void;
  onEdit: (skill: SkillMarketItem) => void;
  onPreviewError: (skillId: string) => void;
  preview: string | null;
  previewBroken: boolean;
}

interface PreparedPreview {
  file: File;
  url: string;
  compressed: boolean;
}

function fileToInput(file: File): Promise<FeedbackImageInput> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      fileName: file.name,
      mimeType: file.type,
      dataBase64: String(reader.result).split(",", 2)[1] ?? "",
    });
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read preview image"));
    reader.readAsDataURL(file);
  });
}

function packageLabel(selection: SkillPackageSelection, t: Translate) {
  return selection.kind === "folder"
    ? t("skills.package.folderSelected", { name: selection.name })
    : t("skills.package.archiveSelected", { name: selection.name });
}

function nextVersion(version: string) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  return match ? `${match[1]}.${match[2]}.${Number(match[3]) + 1}` : version;
}

function SkillInstallButton({ busy, onInstall, skill, t }: SkillInstallButtonProps) {
  return (
    <button type="button"
      className={`skill-install-button${skill.installed ? " installed" : ""}`}
      disabled={busy || skill.installed} onClick={(event) => {
        event.stopPropagation();
        void onInstall(skill);
      }}>
      {busy
        ? <LoaderCircle className="spin" size={16} />
        : skill.installed
          ? <Check size={16} />
          : skill.installedVersion
            ? <RefreshCw size={16} />
            : <Download size={16} />}
      {busy
        ? t("skills.installing")
        : skill.installed
          ? t("skills.installed")
          : skill.installedVersion
            ? t("skills.update", { version: skill.installedVersion })
            : t("skills.install")}
    </button>
  );
}

function SkillDetailModal({
  busy,
  isPublisher,
  onClose,
  onEdit,
  onInstall,
  onPreviewError,
  preview,
  previewBroken,
  skill,
  t,
}: SkillDetailModalProps) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="modal-backdrop skills-detail-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="modal skills-detail-modal" role="dialog" aria-modal="true"
        aria-labelledby="skills-detail-title">
        <button autoFocus type="button" className="modal-close"
          aria-label={t("skills.detail.close")} onClick={onClose}><X size={18} /></button>
        <div className="skills-detail-scroll">
          <div className="skills-detail-preview">
            {preview && !previewBroken ? (
              <img src={preview} alt="" onError={() => onPreviewError(skill.id)} />
            ) : (
              <div className="skill-card-default-preview">
                <PackageOpen size={58} />
                <span>SKILL</span>
              </div>
            )}
            {skill.official && <span className="skill-official-badge">{t("skills.official")}</span>}
            <span className="skill-version">v{skill.version}</span>
          </div>
          <div className="skills-detail-content">
            <h2 id="skills-detail-title">{skill.title}</h2>
            <div className="skills-detail-meta">
              <span><PackageOpen size={15} />{t("skills.publisher")}</span>
              <span><Download size={15} />{t("skills.downloads", { count: skill.installCount })}</span>
            </div>
            <section>
              <h3>{t("skills.field.description")}</h3>
              <p>{skill.description}</p>
            </section>
          </div>
        </div>
        <div className="skills-detail-actions">
          {isPublisher && (
            <button type="button" className="skills-detail-edit" onClick={() => onEdit(skill)}>
              <Edit3 size={16} />{t("skills.edit")}
            </button>
          )}
          <SkillInstallButton busy={busy} onInstall={onInstall} skill={skill} t={t} />
        </div>
      </div>
    </div>
  );
}

function SkillPublishModal({ editing, onClose, onPublished, t }: PublishModalProps) {
  const [title, setTitle] = useState(editing?.title ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [version, setVersion] = useState(editing ? nextVersion(editing.version) : "1.0.0");
  const [selection, setSelection] = useState<SkillPackageSelection | null>(null);
  const [preview, setPreview] = useState<PreparedPreview | null>(null);
  const [preparingPreview, setPreparingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef(preview);
  previewRef.current = preview;

  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current.url);
  }, []);

  const choosePackage = async (kind: SkillPackageSelection["kind"]) => {
    setError(null);
    try {
      const next = kind === "archive" ? await chooseSkillArchive() : await chooseSkillFolder();
      if (next) setSelection(next);
    } catch (caught) {
      setError(String(caught instanceof Error ? caught.message : caught));
    }
  };

  const choosePreview = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPreparingPreview(true);
    setError(null);
    try {
      const prepared = await prepareSkillPreview(file);
      setPreview((current) => {
        if (current) URL.revokeObjectURL(current.url);
        return {
          file: prepared.file,
          url: URL.createObjectURL(prepared.file),
          compressed: prepared.compressed,
        };
      });
    } catch (caught) {
      setError((caught as Error).message === "unsupported"
        ? t("skills.preview.unsupported")
        : t("skills.preview.compressFailed"));
    } finally {
      setPreparingPreview(false);
    }
  };

  const submit = async () => {
    if (!title.trim() || !description.trim() || !version.trim() || !selection) return;
    setSubmitting(true);
    setError(null);
    try {
      await publishSkill({
        skillId: editing?.id,
        title: title.trim(),
        description: description.trim(),
        version: version.trim(),
        package: selection,
        preview: preview ? await fileToInput(preview.file) : null,
      });
      await onPublished();
      onClose();
    } catch (caught) {
      setError(String(caught instanceof Error ? caught.message : caught));
      setSubmitting(false);
    }
  };

  const busy = submitting || preparingPreview;
  return (
    <div className="modal-backdrop skills-publish-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <form className="modal skills-publish-modal" role="dialog" aria-modal="true"
        aria-labelledby="skills-publish-title" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <button type="button" className="modal-close" aria-label={t("skills.publish.close")}
          disabled={busy} onClick={onClose}><X size={18} /></button>
        <div className="modal-icon"><PackageOpen size={23} /></div>
        <h2 id="skills-publish-title">
          {editing ? t("skills.publish.updateTitle") : t("skills.publish.title")}
        </h2>
        <p>{t("skills.publish.description")}</p>

        <div className="skills-publish-grid">
          <label>
            <span>{t("skills.field.title")}</span>
            <input autoFocus maxLength={120} value={title} disabled={busy}
              onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label>
            <span>{t("skills.field.version")}</span>
            <input maxLength={40} value={version} disabled={busy} placeholder="1.0.0"
              onChange={(event) => setVersion(event.target.value)} />
          </label>
        </div>

        <label className="skills-description-field">
          <span>{t("skills.field.description")}</span>
          <textarea rows={4} maxLength={1000} value={description} disabled={busy}
            onChange={(event) => setDescription(event.target.value)} />
          <small>{description.length}/1000</small>
        </label>

        <div className="skills-package-field">
          <div>
            <b>{t("skills.field.package")}</b>
            <small>{t("skills.package.hint")}</small>
          </div>
          <div className="skills-package-actions">
            <button type="button" disabled={busy} onClick={() => void choosePackage("archive")}>
              <Archive size={16} />{t("skills.package.chooseArchive")}
            </button>
            <button type="button" disabled={busy} onClick={() => void choosePackage("folder")}>
              <FolderOpen size={16} />{t("skills.package.chooseFolder")}
            </button>
          </div>
          {selection && <div className="skills-selected-package"><Check size={15} />{packageLabel(selection, t)}</div>}
        </div>

        <div className="skills-preview-field">
          <div>
            <b>{t("skills.field.preview")}</b>
            <small>{t("skills.preview.hint")}</small>
          </div>
          <label className={`skills-preview-picker${preparingPreview ? " disabled" : ""}`}>
            {preparingPreview ? <LoaderCircle className="spin" size={16} /> : <ImagePlus size={16} />}
            {preparingPreview ? t("skills.preview.compressing") : t("skills.preview.choose")}
            <input type="file" accept={FEEDBACK_IMAGE_TYPES.join(",")} disabled={busy}
              onChange={(event) => void choosePreview(event)} />
          </label>
          {preview && (
            <div className="skills-preview-selection">
              <img src={preview.url} alt="" />
              <span>{preview.file.name}{preview.compressed ? ` · ${t("skills.preview.compressed")}` : ""}</span>
              <button type="button" aria-label={t("skills.preview.remove")} disabled={busy} onClick={() => {
                URL.revokeObjectURL(preview.url);
                setPreview(null);
              }}><X size={14} /></button>
            </div>
          )}
        </div>

        {error && <div className="feedback-error" role="alert">{error}</div>}
        <div className="feedback-actions">
          <button type="button" className="note-cancel-button" disabled={busy}
            onClick={onClose}>{t("skills.cancel")}</button>
          <button type="submit" className="primary-button"
            disabled={busy || !title.trim() || !description.trim() || !version.trim() || !selection}>
            {submitting ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}
            {submitting ? t("skills.publish.publishing") : t("skills.publish.submit")}
          </button>
        </div>
      </form>
    </div>
  );
}

export function SkillsMarketPage({
  baseUrl,
  authenticated,
  currentUserId,
  onLogin,
  notify,
  t,
}: SkillsMarketPageProps) {
  const [items, setItems] = useState<SkillMarketItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [editing, setEditing] = useState<SkillMarketItem | null>(null);
  const [detailSkillId, setDetailSkillId] = useState<string | null>(null);
  const [busySkillId, setBusySkillId] = useState<string | null>(null);
  const [brokenPreviews, setBrokenPreviews] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchSkillMarket());
    } catch (caught) {
      setError(String(caught instanceof Error ? caught.message : caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return items;
    return items.filter((item) => `${item.title}\n${item.description}`
      .toLocaleLowerCase().includes(needle));
  }, [items, query]);
  const detailSkill = detailSkillId
    ? items.find((item) => item.id === detailSkillId) ?? null
    : null;

  const openPublish = () => {
    if (!authenticated) {
      onLogin();
      return;
    }
    setPublishing(true);
  };

  const install = async (skill: SkillMarketItem) => {
    setBusySkillId(skill.id);
    try {
      await installMarketSkill(skill);
      notify(skill.installedVersion ? t("skills.toast.updated") : t("skills.toast.installed"));
      await load();
    } catch (caught) {
      setError(String(caught instanceof Error ? caught.message : caught));
    } finally {
      setBusySkillId(null);
    }
  };

  return (
    <div className="skills-market-page">
      <div className="skills-market-toolbar">
        <div className="skills-market-intro">
          <span>{t("skills.kicker")}</span>
          <h2>{t("skills.heading")}</h2>
          <p>{t("skills.description")}</p>
        </div>
        <div className="skills-market-toolbar-actions">
          <label className="skills-market-search">
            <Search size={16} />
            <input value={query} placeholder={t("skills.search")}
              onChange={(event) => setQuery(event.target.value)} />
          </label>
          <button type="button" className="refresh-all" disabled={loading} onClick={() => void load()}>
            <RefreshCw className={loading ? "spin" : ""} size={16} />{t("skills.refresh")}
          </button>
          <button type="button" className="primary-button" onClick={openPublish}>
            <Upload size={16} />{t("skills.publish.action")}
          </button>
        </div>
      </div>

      {!authenticated && (
        <button type="button" className="skills-login-notice" onClick={onLogin}>
          <PackageOpen size={18} />
          <span><b>{t("skills.login.title")}</b><small>{t("skills.login.description")}</small></span>
        </button>
      )}

      {error && <div className="skills-market-error" role="alert">{error}</div>}
      {loading && items.length === 0 ? (
        <div className="skills-market-state"><LoaderCircle className="spin" size={22} />{t("skills.loading")}</div>
      ) : filtered.length === 0 ? (
        <div className="skills-market-state"><PackageOpen size={26} />{t("skills.empty")}</div>
      ) : (
        <div className="skills-market-grid">
          {filtered.map((skill) => {
            const preview = skillPreviewUrl(baseUrl, skill);
            const isPublisher = Boolean(
              authenticated
              && currentUserId
              && skill.uploaderId === currentUserId,
            );
            const busy = busySkillId === skill.id;
            return (
              <article className="skill-card" key={skill.id}>
                <button type="button" className="skill-card-open"
                  aria-label={skill.title} onClick={() => setDetailSkillId(skill.id)} />
                <div className="skill-card-preview">
                  {preview && !brokenPreviews.has(skill.id) ? (
                    <img src={preview} alt="" onError={() => setBrokenPreviews((current) => {
                      const next = new Set(current);
                      next.add(skill.id);
                      return next;
                    })} />
                  ) : (
                    <div className="skill-card-default-preview"><PackageOpen size={34} /><span>SKILL</span></div>
                  )}
                  {skill.official && <span className="skill-official-badge">{t("skills.official")}</span>}
                  <span className="skill-version">v{skill.version}</span>
                </div>
                <div className="skill-card-body">
                  <div className="skill-card-title">
                    <h3>{skill.title}</h3>
                    {isPublisher && (
                      <button type="button" aria-label={t("skills.edit")} onClick={() => {
                        setEditing(skill);
                      }}>
                        <Edit3 size={15} />
                      </button>
                    )}
                  </div>
                  <p>{skill.description}</p>
                  <div className="skill-card-meta">
                    <span>{t("skills.publisher")}</span>
                    <span
                      aria-label={t("skills.downloads", { count: skill.installCount })}
                      title={t("skills.downloads", { count: skill.installCount })}
                    >
                      <Download size={13} />{skill.installCount.toLocaleString()}
                    </span>
                  </div>
                  <SkillInstallButton busy={busy} onInstall={install} skill={skill} t={t} />
                </div>
              </article>
            );
          })}
        </div>
      )}

      {detailSkill && (
        <SkillDetailModal
          busy={busySkillId === detailSkill.id}
          isPublisher={Boolean(
            authenticated
            && currentUserId
            && detailSkill.uploaderId === currentUserId,
          )}
          onClose={() => setDetailSkillId(null)}
          onEdit={(skill) => {
            setDetailSkillId(null);
            setEditing(skill);
          }}
          onInstall={install}
          onPreviewError={(skillId) => setBrokenPreviews((current) => {
            const next = new Set(current);
            next.add(skillId);
            return next;
          })}
          preview={skillPreviewUrl(baseUrl, detailSkill)}
          previewBroken={brokenPreviews.has(detailSkill.id)}
          skill={detailSkill}
          t={t}
        />
      )}

      {(publishing || editing) && (
        <SkillPublishModal editing={editing} onClose={() => {
          setPublishing(false);
          setEditing(null);
        }} onPublished={async () => {
          notify(editing ? t("skills.toast.publishedUpdate") : t("skills.toast.published"));
          await load();
        }} t={t} />
      )}
    </div>
  );
}
