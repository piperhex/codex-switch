import { createContext, useContext, useState } from 'react';
import { useChatImage, type ImagePreviewOptions } from '../../../../shared/remote-chat/client/useChatImage';

export const ChatImageContext = createContext<ImagePreviewOptions | null>(null);

export function ChatImage({ source, description = '图片' }: { source?: string; description?: string }) {
  const image = useChatImage(source, useContext(ChatImageContext));
  const [preview, setPreview] = useState(false);
  if (image.failed) return <span className="chat-image-notice" role="status">
    {description}：图片加载失败 <button type="button" className="chat-button" onClick={image.retry}>重试</button>
  </span>;
  if (image.loading || !image.url) return <span className="chat-image-notice" role="status">正在加载图片…</span>;
  return <>
    <button type="button" className="chat-image" aria-label={`放大查看：${description}`} onClick={() => setPreview(true)}>
      <img key={image.key} src={image.url} alt={description} loading="lazy" decoding="async"
        referrerPolicy="no-referrer" onError={image.fail} />
    </button>
    {preview && <dialog ref={(dialog) => { if (dialog && !dialog.open) dialog.showModal(); }}
      className="chat-image-preview" aria-label={description}
      onCancel={() => setPreview(false)}>
      <button type="button" className="chat-button" aria-label="关闭图片" onClick={() => setPreview(false)}>关闭</button>
      <img src={image.url} alt={description} referrerPolicy="no-referrer" />
    </dialog>}
  </>;
}
