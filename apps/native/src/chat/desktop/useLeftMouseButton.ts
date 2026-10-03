import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, type PanResponderGestureState } from 'react-native';
import type { DesktopViewport } from '../../../../../shared/remote-desktop/geometry';
import type { MouseButtonControls } from '../../../../../shared/remote-desktop/useMouseButtons';
import type { MousePanelActivity } from '../../../../../shared/remote-desktop/useMousePanel';

interface Options { buttons: MouseButtonControls; viewport: DesktopViewport; panel: MousePanelActivity }

export function useLeftMouseButton(options: Options) {
  const latest = useRef(options); latest.current = options;
  const previous = useRef({ active: false, dx: 0, dy: 0 });
  const [pressed, setPressed] = useState(false);
  useEffect(() => () => {
    latest.current.buttons.cancel(); latest.current.panel.hold('left', false);
  }, [options.buttons.cancel, options.panel.hold]);
  const move = (gesture: PanResponderGestureState) => {
    if (!previous.current.active) return;
    const { buttons, viewport } = latest.current;
    buttons.move(gesture.dx - previous.current.dx, gesture.dy - previous.current.dy, viewport);
    previous.current = { active: true, dx: gesture.dx, dy: gesture.dy };
  };
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    // Retain the touch even when the moving panel leaves the finger or crosses the drawer.
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      previous.current = { active: true, dx: 0, dy: 0 };
      setPressed(true); latest.current.panel.hold('left', true); latest.current.buttons.down('left');
    },
    onPanResponderMove: (_event, gesture) => move(gesture),
    onPanResponderRelease: (_event, gesture) => {
      if (!previous.current.active) return;
      move(gesture); previous.current.active = false;
      latest.current.buttons.up('left'); setPressed(false); latest.current.panel.hold('left', false);
    },
    onPanResponderTerminate: () => {
      previous.current.active = false; latest.current.buttons.cancel();
      setPressed(false); latest.current.panel.hold('left', false);
    },
  }), []);
  return { ...responder, pressed };
}
