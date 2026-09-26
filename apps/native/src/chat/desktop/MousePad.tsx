import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DesktopPointer } from '../../../../../shared/remote-desktop/input';
import { desktopStyles as s } from './styles';

interface Props { pointer: DesktopPointer; wheel: (delta: number) => void; width: number; height: number }

export function useTrackpad({ pointer, width, height }: Omit<Props, 'wheel'>) {
  const previous = useRef({ x: 0, y: 0 });
  return useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    // Modal events still reach the chat drawer's React ancestors. Keep an active mouse gesture here.
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { previous.current = { x: 0, y: 0 }; },
    onPanResponderMove: (_, gesture) => {
      pointer.move(gesture.dx - previous.current.x, gesture.dy - previous.current.y, width, height);
      previous.current = { x: gesture.dx, y: gesture.dy };
    },
    onPanResponderRelease: (_, gesture) => {
      pointer.flush();
      if (Math.abs(gesture.dx) + Math.abs(gesture.dy) < 5) pointer.click();
    },
    onPanResponderTerminate: () => { pointer.button('left', false); pointer.button('right', false); },
  }), [pointer, width, height]);
}

export function MousePad(props: Props) {
  const pad = useTrackpad(props);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const origin = useRef(position);
  useEffect(() => setPosition({ x: 0, y: 0 }), [props.width, props.height]);
  const locked = useRef(false);
  const [dragging, setDragging] = useState(false);
  useEffect(() => () => { props.pointer.button('left', false); props.pointer.button('right', false); }, [props.pointer]);
  const press = (button: 'left' | 'right') => {
    if (button === 'left' && locked.current) {
      locked.current = false; setDragging(false); props.pointer.button(button, false); return;
    }
    props.pointer.button(button, true);
  };
  const drag = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { origin.current = position; },
    onPanResponderMove: (_, gesture) => setPosition({
      x: Math.max(-Math.max(0, props.width - 190), Math.min(0, origin.current.x + gesture.dx)),
      y: Math.max(-Math.max(0, props.height - 210), Math.min(0, origin.current.y + gesture.dy)),
    }),
  }), [position, props.width, props.height]);
  return <View style={[s.mouse, { transform: [{ translateX: position.x }, { translateY: position.y }] }]}>
    <View style={s.mouseTop}>{(['left', 'right'] as const).map(button =>
      <Pressable key={button} accessibilityRole="button" accessibilityLabel={button === 'left' ? '鼠标左键' : '鼠标右键'}
        onPressIn={() => press(button)} onPressOut={() => {
          if (button !== 'left' || !locked.current) props.pointer.button(button, false);
        }} onLongPress={() => {
          if (button === 'left') { locked.current = true; setDragging(true); props.pointer.button(button, true); }
        }}
        style={({ pressed }) => [s.mouseButton, button === 'right' && s.mouseRight, pressed && s.pressed]}>
        <Text style={s.mouseText}>{button === 'left' ? (dragging ? '拖拽中' : '左键') : '右键'}</Text>
      </Pressable>)}</View>
    <View {...pad.panHandlers} style={s.pad} accessibilityLabel="滑动移动鼠标，轻点单击">
      <Text style={s.mouseText}>滑动移动</Text></View>
    <View style={s.wheel}>{[120, -120].map(delta =>
      <Pressable key={delta} accessibilityRole="button" accessibilityLabel={delta > 0 ? '向上滚动' : '向下滚动'}
        style={s.wheelButton} onPress={() => props.wheel(delta)}>
        <Ionicons name={delta > 0 ? 'caret-up' : 'caret-down'} size={18} color="#526684" />
      </Pressable>)}</View>
    <View {...drag.panHandlers} style={s.grip} accessibilityLabel="拖动鼠标面板">
      <Ionicons name="reorder-two" size={26} color="#526684" /></View>
  </View>;
}
