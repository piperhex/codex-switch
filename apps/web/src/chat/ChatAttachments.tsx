import { t, useLanguage } from '../i18n';
import { Plus, X } from 'lucide-react';
import { MAX_CHAT_IMAGES, type DraftImage } from '../../../../shared/remote-chat/attachments';
import { itemUploadProgress, type UploadProgress } from '../../../../shared/remote-chat/uploadProgress';
import { ChatUploadProgress } from './ChatUploadProgress';

export function ChatAttachmentPreviews({ images, busy, remove, add, edit, upload, reconnecting }: {
  images: DraftImage[]; busy: boolean; remove: (id: string) => void; add: () => void;
  edit: (id: string) => void; upload?: UploadProgress; reconnecting?: boolean;
}) {
  useLanguage();
  if (!images.length) return null;
  return <div className="chat-attachment-previews">
    {images.map((image, index) => <div key={image.id}
      className={`chat-attachment-preview${upload ? ' is-uploading' : ''}`}>
      <img src={image.url} alt={t("待发送图片 {value1}", { value1: index + 1 })} />
      <ChatUploadProgress progress={itemUploadProgress(upload, 'image', index)} reconnecting={reconnecting} />
      <button type="button" className="chat-attachment-edit" aria-label={t("标注图片 {value1}", { value1: index + 1 })}
        disabled={busy} onClick={() => edit(image.id)}>{t("标注")}</button>
      <button type="button" aria-label={t("移除图片 {value1}", { value1: index + 1 })} disabled={busy}
        onClick={() => remove(image.id)}><X size={16} /></button>
    </div>)}
    {images.length < MAX_CHAT_IMAGES && <button type="button" className="chat-attachment-more"
      aria-label={t("继续添加图片")} disabled={busy} onClick={add}><Plus size={24} /></button>}
  </div>;
}
