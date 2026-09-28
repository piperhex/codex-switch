import { useRef, type PointerEvent } from 'react';
import type { DesktopPointer } from '../../../../../shared/remote-desktop/input';
import type { DesktopViewport } from '../../../../../shared/remote-desktop/geometry';
import type { DesktopInput } from '../../../../../shared/remote-desktop/protocol';
import type { useTrackpad } from './useTrackpad';
import type { useDesktopClipboard } from './useDesktopClipboard';
import { useDesktopMouse } from './useDesktopMouse';
import { useDesktopKeyboard } from './useDesktopKeyboard';
import { t } from '../../i18n';

interface Props {
  pointer: DesktopPointer; viewport: DesktopViewport; input: (input: DesktopInput) => void;
  trackpad: ReturnType<typeof useTrackpad>; hardware: boolean; active: boolean;
  clipboard: ReturnType<typeof useDesktopClipboard>; wheel: (delta: number) => void;
}
export function DesktopInputSurface({ pointer, viewport, input, trackpad, hardware, active, clipboard, wheel }: Props) {
  const capture = useRef<HTMLTextAreaElement>(null);
  const mouse = useDesktopMouse({ pointer, viewport, input, focus: () => capture.current?.focus({ preventScroll: true }) });
  const keyboard = useDesktopKeyboard({ active, input, copy: clipboard.copy, paste: clipboard.paste });
  const route = (name: keyof typeof trackpad) => (event: PointerEvent<HTMLDivElement>) => {
    if (!active) return;
    if (hardware && event.pointerType === 'mouse') mouse[name](event);
    else trackpad[name](event);
  };
  return <>
    <div className="rd-touch" onPointerDown={route('onPointerDown')} onPointerMove={route('onPointerMove')}
      onPointerUp={route('onPointerUp')} onPointerCancel={route('onPointerCancel')}
      onLostPointerCapture={route('onLostPointerCapture')}
      onWheel={event => { if (!active) return;
        if (hardware) mouse.onWheel(event); else wheel(event.deltaY > 0 ? -120 : 120); }}
      aria-label={t('远程桌面触控区域')} />
    <textarea ref={capture} className="rd-key-capture" tabIndex={-1} inputMode="none" spellCheck={false}
      autoCapitalize="off" autoComplete="off" aria-label={t('远程桌面键盘输入')} {...keyboard.handlers} />
  </>;
}
