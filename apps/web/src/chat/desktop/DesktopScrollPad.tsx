import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { SCROLL_PAD_SIZE } from '../../../../../shared/remote-desktop/scrollPad';
import type { ScrollPadProps } from '../../../../../shared/remote-desktop/useScrollPad';
import { t } from '../../i18n';
import './scrollPad.css';

export function DesktopScrollPad({ layout, position, horizontal, cancel }: ScrollPadProps) {
  return <div className="rd-scroll-layer" onPointerDown={event => { event.preventDefault(); cancel(); }}>
    <div className="rd-scroll-pad" role="group" aria-label={t('十字滚动滑块')}
      style={{ left: layout.x, top: layout.y, width: layout.size, height: layout.size }}>
      <div className="rd-scroll-cross rd-scroll-vertical" /><div className="rd-scroll-cross rd-scroll-horizontal" />
      <div className="rd-scroll-center" />
      <ChevronUp className="rd-scroll-arrow rd-scroll-up" aria-hidden="true" />
      <ChevronDown className="rd-scroll-arrow rd-scroll-down" aria-hidden="true" />
      <ChevronLeft className="rd-scroll-arrow rd-scroll-left" opacity={horizontal ? 1 : .3} aria-hidden="true" />
      <ChevronRight className="rd-scroll-arrow rd-scroll-right" opacity={horizontal ? 1 : .3} aria-hidden="true" />
      <div className="rd-scroll-knob" style={{ left: `${50 + position.x / SCROLL_PAD_SIZE * 100}%`,
        top: `${50 + position.y / SCROLL_PAD_SIZE * 100}%` }} />
    </div>
    {!horizontal && <div className="rd-scroll-hint">{t('更新远程电脑上的应用后，即可左右滚动。')}</div>}
  </div>;
}
