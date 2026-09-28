import { useEffect, useMemo, useRef } from 'react';
import { AppState, PanResponder, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SCROLL_PAD_SIZE, scrollPadLayout } from '../../../../../shared/remote-desktop/scrollPad';
import { useScrollPad, type ScrollPadProps } from '../../../../../shared/remote-desktop/useScrollPad';
import { scrollPadStyles as s } from './scrollPadStyles';

export function DesktopScrollPad(props: ScrollPadProps) {
  const { controller, position } = useScrollPad(props);
  const layout = scrollPadLayout(props.viewport, props.pointer.getSnapshot());
  const scale = layout.size / SCROLL_PAD_SIZE;
  const origin = useRef({ x: 0, y: 0 });
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: ({ nativeEvent }) => {
      origin.current = { x: nativeEvent.locationX / scale - SCROLL_PAD_SIZE / 2,
        y: nativeEvent.locationY / scale - SCROLL_PAD_SIZE / 2 };
      controller.start(origin.current);
    },
    onPanResponderStart: (_event, gesture) => { if (gesture.numberActiveTouches > 1) controller.stop(); },
    onPanResponderMove: (_event, gesture) => controller.move({
      x: origin.current.x + gesture.dx / scale, y: origin.current.y + gesture.dy / scale }),
    onPanResponderRelease: () => controller.end(),
    onPanResponderTerminate: () => controller.stop(),
    onPanResponderTerminationRequest: () => true,
  }), [controller, scale]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') controller.stop(); });
    return () => subscription.remove();
  }, [controller]);
  const arrows = [
    { name: 'chevron-up', x: .5, y: .15 }, { name: 'chevron-down', x: .5, y: .85 },
    { name: 'chevron-back', x: .15, y: .5 }, { name: 'chevron-forward', x: .85, y: .5 },
  ] as const;
  return <View style={s.layer}>
    <Pressable style={s.dismiss} accessibilityRole="button" accessibilityLabel="收起滚动滑块" onPress={props.close} />
    <View style={[s.pad, { left: layout.x, top: layout.y, width: layout.size, height: layout.size }]}
      accessibilityLabel="十字滚动滑块" {...pan.panHandlers}>
      <View pointerEvents="none" style={[s.cross, s.vertical]} />
      <View pointerEvents="none" style={[s.cross, s.horizontal]} />
      <View pointerEvents="none" style={s.center} />
      {arrows.map(arrow => <View key={arrow.name} pointerEvents="none" style={[s.arrow,
        { left: layout.size * arrow.x - 10, top: layout.size * arrow.y - 10,
          opacity: arrow.y === .5 && !props.horizontal ? .3 : 1 }]}>
        <Ionicons name={arrow.name} size={20} color="#dce3ec" /></View>)}
      <View pointerEvents="none" style={[s.knob, {
        width: layout.size * .27, height: layout.size * .27,
        left: layout.size * .365 + position.x * scale, top: layout.size * .365 + position.y * scale,
      }]} />
    </View>
    {!props.horizontal && <View pointerEvents="none" style={s.hint}>
      <Text style={s.hintText}>更新远程电脑上的应用后，即可左右滚动。</Text></View>}
  </View>;
}
