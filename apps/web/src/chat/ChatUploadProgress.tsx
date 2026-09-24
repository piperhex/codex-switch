import { t, useLanguage } from '../i18n';
import type { UploadProgress } from '../../../../shared/remote-chat/uploadProgress';
import './uploadProgress.css';

export function ChatUploadProgress({ progress, reconnecting = false, inline = false }: {
  progress?: UploadProgress; reconnecting?: boolean; inline?: boolean;
}) {
  useLanguage();
  if (!progress) return null;
  let label = t('上传中');
  if (progress.percent === 0) label = t('待上传');
  if (progress.percent === 100) label = t('已上传');
  if (progress.phase === 'preparing') label = t('准备中');
  if (progress.phase === 'confirming') label = t('等待确认');
  if (reconnecting && progress.percent < 100) label = t('等待连接');
  return <span className={inline ? 'chat-upload-inline' : 'chat-upload-overlay'}
    role="progressbar" aria-label={t('附件上传进度')} aria-valuetext={`${label} ${progress.percent}%`}
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}>
    <span className="chat-upload-percent">{progress.percent}%</span>
    <span className="chat-upload-label">{label}</span>
    {!inline && <span className="chat-upload-track"><i style={{ width: `${progress.percent}%` }} /></span>}
  </span>;
}
