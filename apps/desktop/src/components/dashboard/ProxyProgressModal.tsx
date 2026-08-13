import { Modal, Progress } from "antd";
import type { Translate, TranslationKey } from "../../i18n";

interface ProxyProgress {
  percent: number;
  phase: string;
  processedFiles?: number | null;
  totalFiles?: number | null;
}

interface ProxyProgressModalProps {
  fileLabelKey: TranslationKey;
  hintKey: TranslationKey;
  phaseKeys: Record<string, TranslationKey>;
  progress: ProxyProgress | null;
  t: Translate;
  titleKey: TranslationKey;
}

export function ProxyProgressModal({
  fileLabelKey,
  hintKey,
  phaseKeys,
  progress,
  t,
  titleKey,
}: ProxyProgressModalProps) {
  return (
    <Modal className="proxy-stop-progress-modal" open={Boolean(progress)} footer={null}
      closable={false} maskClosable={false} keyboard={false} centered title={t(titleKey)}>
      {progress && (
        <div className="proxy-stop-progress-content">
          <Progress percent={Math.round(progress.percent)}
            status={progress.phase === "failed" ? "exception"
              : progress.phase === "complete" ? "success" : "active"}
            strokeColor="var(--green)" />
          <p role="status" aria-live="polite">{t(phaseKeys[progress.phase])}</p>
          {progress.totalFiles != null && progress.processedFiles != null && (
            <span>{t(fileLabelKey, {
              processed: progress.processedFiles,
              total: progress.totalFiles,
            })}</span>
          )}
          <small>{t(hintKey)}</small>
        </div>
      )}
    </Modal>
  );
}
