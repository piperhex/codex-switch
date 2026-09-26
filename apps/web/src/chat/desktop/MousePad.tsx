import { useEffect, useSyncExternalStore } from 'react';
import { ChevronDown, ChevronUp, GripHorizontal, Mouse, X } from 'lucide-react';
import type { DesktopPointer } from '../../../../../shared/remote-desktop/input';
import { cursorPosition, mousePanelPosition, MOUSE_PANEL_SIZE, MOUSE_ICON_SIZE, MOUSE_SIZE, CURSOR_SIZE,
  type DesktopViewport }
  from '../../../../../shared/remote-desktop/geometry';
import type { MousePanelActivity } from '../../../../../shared/remote-desktop/useMousePanel';
import cursorImage from '../../../../../shared/remote-desktop/cursor.svg';
import { t } from '../../i18n';
import { useMouseButtons } from './useMouseButtons';
import { useTrackpad } from './useTrackpad';

interface Props {
  pointer: DesktopPointer; viewport: DesktopViewport; panel: MousePanelActivity;
  wheel: (delta: number) => void;
}
export function DesktopMouse({ visible, ...props }: Props & { visible: boolean }) {
  const position = useSyncExternalStore(props.pointer.subscribe, props.pointer.getSnapshot);
  const cursor = cursorPosition(position, props.viewport);
  const panel = mousePanelPosition(cursor);
  const panelSize = props.panel.expanded ? MOUSE_PANEL_SIZE : MOUSE_ICON_SIZE;
  return <>
    <img className="rd-cursor" src={cursorImage} alt="" aria-hidden="true" draggable={false}
      style={{ ...CURSOR_SIZE, left: cursor.x, top: cursor.y }} />
    {visible && <div className="rd-mouse-layer" style={{ ...panelSize, left: panel.x, top: panel.y }}>
      {props.panel.expanded ? <MousePad {...props} />
        : <button className="rd-mouse-icon" aria-label={t('展开鼠标面板')} onClick={props.panel.expand}><Mouse /></button>}
    </div>}
  </>;
}

function MousePad({ pointer, viewport, panel, wheel }: Props) {
  const buttons = useMouseButtons(pointer);
  const pad = useTrackpad({ pointer, viewport, panel, id: 'pad', cancel: buttons.cancel });
  const grip = useTrackpad({ pointer, viewport, panel, id: 'grip', click: false, cancel: buttons.cancel });
  useEffect(() => { panel.hold('drag', buttons.dragging); return () => panel.hold('drag', false); },
    [buttons.dragging, panel.hold]);
  const up = (button: 'left' | 'right') => { buttons.up(button); panel.hold(button, false); };
  return <>
    <div className="rd-mouse" style={MOUSE_SIZE}>
      <div className="rd-mouse-top">{(['left', 'right'] as const).map(button =>
        <button key={button} aria-label={t(button === 'left' ? '鼠标左键' : '鼠标右键')}
          aria-pressed={button === 'left' && buttons.dragging}
          onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId);
            panel.hold(button, true); buttons.down(button); }}
          onPointerUp={() => up(button)} onLostPointerCapture={() => up(button)}
          onPointerCancel={() => { buttons.cancel(); panel.hold(button, false); }}>
          {t(button === 'left' ? (buttons.dragging ? '拖拽中' : '左键') : '右键')}</button>)}</div>
      <div className="rd-pad" {...pad}>{t('滑动移动')}</div>
      <div className="rd-wheel">{[120, -120].map(delta =>
        <button key={delta} aria-label={t(delta > 0 ? '向上滚动' : '向下滚动')}
          onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); panel.hold('wheel', true); }}
          onPointerUp={() => panel.hold('wheel', false)} onLostPointerCapture={() => panel.hold('wheel', false)}
          onPointerCancel={() => panel.hold('wheel', false)}
          onClick={() => { panel.activity(); wheel(delta); }}>
          {delta > 0 ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button>)}</div>
      <button className="rd-grip" aria-label={t('拖动鼠标面板')} {...grip}><GripHorizontal size={22} /></button>
    </div>
    <button className="rd-mouse-close" aria-label={t('收起鼠标面板')} onClick={panel.collapse}><X size={20} /></button>
  </>;
}
