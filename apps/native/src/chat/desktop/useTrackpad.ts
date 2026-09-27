import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder } from 'react-native';
import type { DesktopPointer } from '../../../../../shared/remote-desktop/input';
import { desktopPoint, type DesktopViewport } from '../../../../../shared/remote-desktop/geometry';
import type { MousePanelActivity } from '../../../../../shared/remote-desktop/useMousePanel';
import type { DesktopZoom } from '../../../../../shared/remote-desktop/zoom';
import { usePinchZoom } from './usePinchZoom';

interface Options {
  pointer: DesktopPointer; viewport: DesktopViewport; direct?: boolean; click?: boolean;
  panel: MousePanelActivity; id: string; cancel?: () => void; zoom?: DesktopZoom;
}
export function useTrackpad(options: Options) {
  const latest = useRef(options); latest.current = options;
  const pinch = usePinchZoom(options);
  const [pressed, setPressed] = useState(false);
  const previous = useRef({ dx: 0, dy: 0, x: 0, y: 0, distance: 0, accepted: false });
  useEffect(() => () => {
    const { pointer, panel, id } = latest.current;
    pinch.end(); pointer.release(); panel.hold(id, false);
  }, [options.pointer, options.direct]);
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    // Keep a mouse drag in this modal instead of giving it to the chat drawer.
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: event => {
      const { pointer, viewport, direct, panel, id } = latest.current;
      const { locationX: x, locationY: y } = event.nativeEvent;
      const target = direct ? desktopPoint({ x, y }, viewport) : undefined;
      previous.current = { dx: 0, dy: 0, x, y, distance: 0, accepted: !!target };
      setPressed(true); panel.hold(id, true);
      if (pinch.start(event)) return;
      if (target) { pointer.absolute(target.x, target.y); pointer.button('left', true); }
    },
    onPanResponderStart: event => { pinch.update(event); },
    onPanResponderEnd: event => { pinch.update(event); },
    onPanResponderMove: (event, gesture) => {
      if (pinch.update(event)) return;
      const { pointer, viewport, direct } = latest.current;
      const before = previous.current;
      const dx = gesture.dx - before.dx; const dy = gesture.dy - before.dy;
      if (direct) {
        const target = before.accepted && desktopPoint({ x: before.x + gesture.dx, y: before.y + gesture.dy }, viewport, true);
        if (target) pointer.absolute(target.x, target.y);
      } else pointer.move(dx, dy, viewport.content.width - 1, viewport.content.height - 1);
      previous.current = { ...before, dx: gesture.dx, dy: gesture.dy,
        distance: before.distance + Math.abs(dx) + Math.abs(dy) };
    },
    onPanResponderRelease: () => {
      const { pointer, direct, click = true, panel, id } = latest.current;
      const pinched = pinch.end();
      if (direct) { if (previous.current.accepted) pointer.button('left', false); }
      else if (!pinched && click && previous.current.distance < 5) pointer.click();
      pointer.flush(); setPressed(false); panel.hold(id, false);
    },
    onPanResponderTerminate: () => {
      const { pointer, panel, id, cancel } = latest.current;
      pinch.end(); pointer.release(); cancel?.(); setPressed(false); panel.hold(id, false);
    },
  }), []);
  return { ...responder, pressed };
}
