import { useEffect, useRef, type PointerEvent } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { SCROLL_PAD_SIZE, scrollPadLayout } from '../../../../../shared/remote-desktop/scrollPad';
import { useScrollPad, type ScrollPadProps } from '../../../../../shared/remote-desktop/useScrollPad';
import { t } from '../../i18n';
import './scrollPad.css';

export function DesktopScrollPad(props: ScrollPadProps) {
  const { controller, position } = useScrollPad(props);
  const captured = useRef<number>();
  const layout = scrollPadLayout(props.viewport, props.pointer.getSnapshot());
  useEffect(() => {
    const stop = () => { captured.current = undefined; controller.stop(); };
    const hidden = () => { if (document.hidden) stop(); };
    window.addEventListener('blur', stop); document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('blur', stop); document.removeEventListener('visibilitychange', hidden);
    };
  }, [controller]);
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - bounds.x) * SCROLL_PAD_SIZE / bounds.width - SCROLL_PAD_SIZE / 2,
      y: (event.clientY - bounds.y) * SCROLL_PAD_SIZE / bounds.height - SCROLL_PAD_SIZE / 2 };
  };
  return <div className="rd-scroll-layer">
    <button className="rd-scroll-dismiss" aria-label={t('收起滚动滑块')} onClick={props.close} />
    <div className="rd-scroll-pad" role="group" aria-label={t('十字滚动滑块')}
      style={{ left: layout.x, top: layout.y, width: layout.size, height: layout.size }}
      onPointerDown={event => {
        if (captured.current !== undefined) return;
        event.preventDefault(); captured.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId); controller.start(point(event));
      }}
      onPointerMove={event => { if (captured.current === event.pointerId) controller.move(point(event)); }}
      onPointerUp={event => {
        if (captured.current !== event.pointerId) return;
        captured.current = undefined; controller.end();
      }}
      onPointerCancel={() => { captured.current = undefined; controller.stop(); }}
      onLostPointerCapture={() => { captured.current = undefined; controller.stop(); }}>
      <div className="rd-scroll-cross rd-scroll-vertical" /><div className="rd-scroll-cross rd-scroll-horizontal" />
      <div className="rd-scroll-center" />
      <ChevronUp className="rd-scroll-arrow rd-scroll-up" aria-hidden="true" />
      <ChevronDown className="rd-scroll-arrow rd-scroll-down" aria-hidden="true" />
      <ChevronLeft className="rd-scroll-arrow rd-scroll-left" opacity={props.horizontal ? 1 : .3} aria-hidden="true" />
      <ChevronRight className="rd-scroll-arrow rd-scroll-right" opacity={props.horizontal ? 1 : .3}
        aria-hidden="true" />
      <div className="rd-scroll-knob" style={{ left: `${50 + position.x / SCROLL_PAD_SIZE * 100}%`,
        top: `${50 + position.y / SCROLL_PAD_SIZE * 100}%` }} />
    </div>
    {!props.horizontal && <div className="rd-scroll-hint">{t('更新远程电脑上的应用后，即可左右滚动。')}</div>}
  </div>;
}
