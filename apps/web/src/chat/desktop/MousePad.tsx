import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ChevronDown, ChevronUp, GripHorizontal } from 'lucide-react';
import type { DesktopPointer } from '../../../../../shared/remote-desktop/input';
import { t } from '../../i18n';
import { useMouseButtons } from './useMouseButtons';

export function useTrackpad(pointer: DesktopPointer) {
  const gesture = useRef<{ id: number; x: number; y: number; distance: number }>();
  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (gesture.current) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, distance: 0 };
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const previous = gesture.current;
      if (!previous || previous.id !== event.pointerId) return;
      const dx = event.clientX - previous.x; const dy = event.clientY - previous.y;
      const area = event.currentTarget.closest('.rd-stage')?.getBoundingClientRect();
      pointer.move(dx, dy, area?.width ?? 800, area?.height ?? 600);
      gesture.current = { id: previous.id, x: event.clientX, y: event.clientY,
        distance: previous.distance + Math.abs(dx) + Math.abs(dy) };
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (gesture.current?.id !== event.pointerId) return;
      if (gesture.current.distance < 5) pointer.click();
      pointer.flush(); gesture.current = undefined;
    },
    onPointerCancel: () => {
      gesture.current = undefined; pointer.button('left', false); pointer.button('right', false);
    },
  };
}

export function MousePad({ pointer, wheel }: { pointer: DesktopPointer; wheel: (delta: number) => void }) {
  const pad = useTrackpad(pointer);
  const buttons = useMouseButtons(pointer);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const origin = useRef<{ x: number; y: number; dx: number; dy: number }>();
  useEffect(() => {
    const reset = () => setPosition({ x: 0, y: 0 });
    window.addEventListener('resize', reset);
    return () => window.removeEventListener('resize', reset);
  }, []);
  const drag = (event: PointerEvent<HTMLButtonElement>) => {
    if (!origin.current) return;
    const bounds = event.currentTarget.closest('.rd-stage')!.getBoundingClientRect();
    setPosition({ x: Math.max(-Math.max(0, bounds.width - 210),
      Math.min(0, origin.current.dx + event.clientX - origin.current.x)),
    y: Math.max(-Math.max(0, bounds.height - 230),
      Math.min(0, origin.current.dy + event.clientY - origin.current.y)) });
  };
  return <div className="rd-mouse" style={{ transform: `translate(${position.x}px, ${position.y}px)` }}>
    <div className="rd-mouse-top">{(['left', 'right'] as const).map(button =>
      <button key={button} aria-label={t(button === 'left' ? '鼠标左键' : '鼠标右键')}
        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); buttons.down(button); }}
        onPointerUp={() => buttons.up(button)} onLostPointerCapture={() => buttons.up(button)}
        onPointerCancel={buttons.cancel}>
        {t(button === 'left' ? (buttons.dragging ? '拖拽中' : '左键') : '右键')}</button>)}</div>
    <div className="rd-pad" {...pad}>{t('滑动移动')}</div>
    <div className="rd-wheel"><button aria-label={t('向上滚动')} onClick={() => wheel(120)}><ChevronUp size={20} /></button>
      <button aria-label={t('向下滚动')} onClick={() => wheel(-120)}><ChevronDown size={20} /></button></div>
    <button className="rd-grip" aria-label={t('拖动鼠标面板')}
      onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId);
        origin.current = { x: event.clientX, y: event.clientY, dx: position.x, dy: position.y }; }}
      onPointerMove={drag} onPointerUp={() => { origin.current = undefined; }}
      onPointerCancel={() => { origin.current = undefined; }}><GripHorizontal size={25} /></button>
  </div>;
}
