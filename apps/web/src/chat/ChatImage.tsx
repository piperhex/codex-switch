import { createContext, useContext, useState } from 'react';
import { useChatImage, type ImagePreviewOptions } from '../../../../shared/remote-chat/client/useChatImage';
import { ImageViewer } from '../../../../shared/chat/ImageViewer';

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
    {preview && <ImageViewer key={image.key} thumbnail={image.url} description={description}
      load={image.original} close={() => setPreview(false)} />}
  </>;
}
