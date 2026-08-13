import { Archive, Check, FolderOpen, ImagePlus, LoaderCircle, PackageOpen, Upload, X } from "lucide-react";
import type { Translate } from "../../i18n";
import type { SkillPackageSelection } from "../../types";
import { FEEDBACK_IMAGE_TYPES } from "../../utils/feedbackImages";
import type { PublishModalProps } from "./types";
import { useSkillPublishForm } from "./useSkillPublishForm";

function packageLabel(selection: SkillPackageSelection, t: Translate) {
  return selection.kind === "folder"
    ? t("skills.package.folderSelected", { name: selection.name })
    : t("skills.package.archiveSelected", { name: selection.name });
}

export function SkillPublishModal(props: PublishModalProps) {
  const { editing, onClose, t } = props;
  const form = useSkillPublishForm(props);
  const {
    busy, choosePackage, choosePreview, description, error, preparingPreview, preview,
    selection, setDescription, setPreview, setTitle, setVersion, submit, submitting,
    title, version,
  } = form;
  return (
    <div
      className="modal-backdrop skills-publish-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form
        className="modal skills-publish-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="skills-publish-title"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <button
          type="button"
          className="modal-close"
          aria-label={t("skills.publish.close")}
          disabled={busy}
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <div className="modal-icon"><PackageOpen size={23} /></div>
        <h2 id="skills-publish-title">
          {editing ? t("skills.publish.updateTitle") : t("skills.publish.title")}
        </h2>
        <p>{t("skills.publish.description")}</p>

        <div className="skills-publish-grid">
          <label>
            <span>{t("skills.field.title")}</span>
            <input
              autoFocus
              maxLength={120}
              value={title}
              disabled={busy}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            <span>{t("skills.field.version")}</span>
            <input
              maxLength={40}
              value={version}
              disabled={busy}
              placeholder="1.0.0"
              onChange={(event) => setVersion(event.target.value)}
            />
          </label>
        </div>

        <label className="skills-description-field">
          <span>{t("skills.field.description")}</span>
          <textarea
            rows={4}
            maxLength={1000}
            value={description}
            disabled={busy}
            onChange={(event) => setDescription(event.target.value)}
          />
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
          {selection && (
            <div className="skills-selected-package">
              <Check size={15} />{packageLabel(selection, t)}
            </div>
          )}
        </div>

        <div className="skills-preview-field">
          <div>
            <b>{t("skills.field.preview")}</b>
            <small>{t("skills.preview.hint")}</small>
          </div>
          <label className={`skills-preview-picker${preparingPreview ? " disabled" : ""}`}>
            {preparingPreview ? <LoaderCircle className="spin" size={16} /> : <ImagePlus size={16} />}
            {preparingPreview ? t("skills.preview.compressing") : t("skills.preview.choose")}
            <input
              type="file"
              accept={FEEDBACK_IMAGE_TYPES.join(",")}
              disabled={busy}
              onChange={(event) => void choosePreview(event)}
            />
          </label>
          {preview && (
            <div className="skills-preview-selection">
              <img src={preview.url} alt="" />
              <span>
                {preview.file.name}
                {preview.compressed ? ` · ${t("skills.preview.compressed")}` : ""}
              </span>
              <button
                type="button"
                aria-label={t("skills.preview.remove")}
                disabled={busy}
                onClick={() => {
                  URL.revokeObjectURL(preview.url);
                  setPreview(null);
                }}
              >
                <X size={14} />
              </button>
            </div>
          )}
        </div>

        {error && <div className="feedback-error" role="alert">{error}</div>}
        <div className="feedback-actions">
          <button type="button" className="note-cancel-button" disabled={busy} onClick={onClose}>
            {t("skills.cancel")}
          </button>
          <button
            type="submit"
            className="primary-button"
            disabled={busy || !title.trim() || !description.trim() || !version.trim() || !selection}
          >
            {submitting ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}
            {submitting ? t("skills.publish.publishing") : t("skills.publish.submit")}
          </button>
        </div>
      </form>
    </div>
  );
}
