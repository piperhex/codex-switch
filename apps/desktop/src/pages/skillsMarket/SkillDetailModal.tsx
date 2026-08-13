import { useEffect } from "react";
import { Download, Edit3, PackageOpen, X } from "lucide-react";
import { SkillInstallButton } from "./SkillInstallButton";
import type { SkillDetailModalProps } from "./types";

export function SkillDetailModal({
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
    <div
      className="modal-backdrop skills-detail-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal skills-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="skills-detail-title"
      >
        <button
          autoFocus
          type="button"
          className="modal-close"
          aria-label={t("skills.detail.close")}
          onClick={onClose}
        >
          <X size={18} />
        </button>
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
