import { Download, Rocket, X } from "lucide-react";
import type { Translate } from "../../i18n";
import type { UpdateInfo } from "../../types";

interface UpdateModalProps {
  update: UpdateInfo;
  onClose: () => void;
  onDownload: () => void;
  onInstall: () => void;
  downloading: boolean;
  downloadRequested: boolean;
  downloaded: boolean;
  installing: boolean;
  progress: number | null;
  error: string | null;
  t: Translate;
}

export function UpdateModal({
  update,
  onClose,
  onDownload,
  onInstall,
  downloading,
  downloadRequested,
  downloaded,
  installing,
  progress,
  error,
  t,
}: UpdateModalProps) {
  return (
    <div className="modal-backdrop" onClick={installing ? undefined : onClose}>
      <section className="modal update-modal" role="dialog" aria-modal="true"
        aria-labelledby="update-modal-title" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" aria-label={t("update.close")} disabled={installing} onClick={onClose}>
          <X size={19} />
        </button>
        <div className="modal-icon"><Rocket size={25} /></div>
        <h2 id="update-modal-title">{t(downloaded ? "update.title" : "update.availableTitle")}</h2>
        <p>{t(downloaded ? "update.description" : "update.availableDescription", { version: update.latestVersion })}</p>
        <div className="update-versions">
          <span>{t("update.currentVersion")} <b>v{update.currentVersion}</b></span>
          <span>{t("update.latestVersion")} <b>v{update.latestVersion}</b></span>
        </div>
        {update.releaseNotes && (
          <div className="update-notes">
            <b>{update.releaseName}</b>
            <pre>{update.releaseNotes}</pre>
          </div>
        )}
        {downloading && !downloaded && <p role="status">{progress === null
          ? t("update.backgroundDownloading")
          : t("update.downloading", { progress })}</p>}
        {installing && <p role="status">{t("update.installing")}</p>}
        {error && <p role="alert">{t("update.installError", { error })}</p>}
        <div className="update-actions">
          <button type="button" className="refresh-all" disabled={installing} onClick={onClose}>{t("update.later")}</button>
          {downloaded ? (
            <button type="button" className="primary-button" disabled={installing} onClick={onInstall}>
              <Download size={17} />{installing ? t("update.installing") : t("update.download")}
            </button>
          ) : (
            <button type="button" className="primary-button" disabled={downloadRequested} onClick={onDownload}>
              <Download size={17} />{downloadRequested ? t("update.waitingToInstall") : t("update.downloadAndInstall")}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
