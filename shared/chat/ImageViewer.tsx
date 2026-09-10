import { useRef, useState, type PointerEvent } from 'react';
import { useImageViewer } from './useImageViewer';
import { clampZoom, INITIAL_TRANSFORM, moveImage, type Point } from './imageTransform';
import './imageViewer.css';

interface Props { thumbnail: string; description: string; load: () => Promise<string>; close: () => void }

export function ImageViewer({ thumbnail, description, load, close }: Props) {
  const image = useImageViewer(load);
  const [transform, setTransform] = useState(INITIAL_TRANSFORM);
  const pointers = useRef(new Map<number, Point>());
  const anchor = useRef({ before: transform, start: [] as Point[] });
  const point = (event: PointerEvent) => ({ x: event.clientX, y: event.clientY });
  const rebase = () => { anchor.current = { before: transform, start: [...pointers.current.values()] }; };
  return <dialog ref={(dialog) => { if (dialog && !dialog.open) dialog.showModal(); }}
    className="cs-image-viewer" aria-label={description} onCancel={close}>
    <div className="cs-image-stage" onWheel={(event) => setTransform((old) => ({ ...old,
      scale: clampZoom(old.scale * (event.deltaY < 0 ? 1.2 : 1 / 1.2)) }))}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        pointers.current.set(event.pointerId, point(event)); rebase();
      }} onPointerMove={(event) => {
        if (!pointers.current.has(event.pointerId)) return;
        pointers.current.set(event.pointerId, point(event));
        setTransform(moveImage({ ...anchor.current, current: [...pointers.current.values()] }));
      }} onPointerUp={(event) => { pointers.current.delete(event.pointerId); rebase(); }}
      onPointerCancel={() => pointers.current.clear()} onDoubleClick={() => setTransform(INITIAL_TRANSFORM)}>
      <img src={image.url ?? thumbnail} alt={description} draggable={false} referrerPolicy="no-referrer"
        onError={image.fail} style={{ transform: `translate(${transform.x}px, ${transform.y}px) `
          + `rotate(${transform.rotation}deg) scale(${transform.scale})` }} />
    </div>
    <button type="button" className="cs-image-close" aria-label="关闭图片" onClick={close}>×</button>
    <div className="cs-image-toolbar">
      <button type="button" aria-label="缩小图片" onClick={() => setTransform((v) => ({ ...v,
        scale: clampZoom(v.scale / 1.5) }))}>−</button>
      <button type="button" aria-label="还原图片" onClick={() => setTransform(INITIAL_TRANSFORM)}>
        {Math.round(transform.scale * 100)}%</button>
      <button type="button" aria-label="放大图片" onClick={() => setTransform((v) => ({ ...v,
        scale: clampZoom(v.scale * 1.5) }))}>+</button>
      <button type="button" aria-label="旋转图片" onClick={() => setTransform((v) => ({ ...v,
        rotation: (v.rotation + 90) % 360 }))}>↻</button>
    </div>
    {!image.url && !image.error && <div className="cs-image-status" role="status">正在加载原图…</div>}
    {image.error && <div className="cs-image-status" role="status">原图加载失败
      <button type="button" onClick={image.retry}>重试</button></div>}
  </dialog>;
}
