import { Image as ImageIcon, Plus, X } from 'lucide-react';
import { AdaptiveSheet } from '../components/AdaptiveSheet';
import { MAX_CHAT_IMAGES, type DraftImage } from '../../../../shared/remote-chat/attachments';

export function ChatAttachmentPreviews({ images, busy, remove, add }: {
  images: DraftImage[]; busy: boolean; remove: (id: string) => void; add: () => void;
}) {
  if (!images.length) return null;
  return <div className="chat-attachment-previews">
    {images.map((image, index) => <div key={image.id} className="chat-attachment-preview">
      <img src={image.url} alt={`待发送图片 ${index + 1}`} />
      <button type="button" aria-label={`移除图片 ${index + 1}`} disabled={busy}
        onClick={() => remove(image.id)}><X size={16} /></button>
    </div>)}
    {images.length < MAX_CHAT_IMAGES && <button type="button" className="chat-attachment-more"
      aria-label="继续添加图片" disabled={busy} onClick={add}><Plus size={24} /></button>}
  </div>;
}

export function ChatAttachmentSheet({ busy, pick, onClose }: {
  busy: boolean; pick: () => void; onClose: () => void;
}) {
  return <AdaptiveSheet open title="添加图片" width={400} onClose={onClose}>
    <div className="chat-attachment-sheet">
      <button type="button" className="chat-album" disabled={busy} onClick={pick}>
        <span><ImageIcon size={30} /></span>相册
      </button>
    </div>
  </AdaptiveSheet>;
}
