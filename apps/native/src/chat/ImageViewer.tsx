import { useMemo, useRef, useState } from 'react';
import { Image, Modal, PanResponder, Pressable, StyleSheet, Text, View,
  type GestureResponderEvent } from 'react-native';
import { useImageViewer } from '../../../../shared/chat/useImageViewer';
import { INITIAL_TRANSFORM, clampZoom, moveImage, type Point } from '../../../../shared/chat/imageTransform';

interface Props { thumbnail: string; description: string; load: () => Promise<string>; close: () => void }
const points = (event: GestureResponderEvent): Point[] => event.nativeEvent.touches.map((touch) =>
  ({ x: touch.pageX, y: touch.pageY }));

export function ImageViewer({ thumbnail, description, load, close }: Props) {
  const image = useImageViewer(load);
  const [transform, setTransform] = useState(INITIAL_TRANSFORM);
  const current = useRef(transform);
  current.current = transform;
  const anchor = useRef({ before: transform, start: [] as Point[] });
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => { anchor.current = { before: current.current, start: points(event) }; },
    onPanResponderMove: (event) => {
      const touches = points(event);
      if (touches.length !== anchor.current.start.length) {
        anchor.current = { before: current.current, start: touches };
      }
      setTransform(moveImage({ ...anchor.current, current: touches }));
    },
  }), []);
  return <Modal visible transparent animationType="fade" onRequestClose={close}>
    <View style={styles.overlay}>
      <View style={styles.stage} {...responder.panHandlers}>
        <Image source={{ uri: image.url ?? thumbnail }} accessibilityLabel={description} resizeMode="contain"
          onError={image.fail} style={[styles.image, { transform: [{ translateX: transform.x },
            { translateY: transform.y }, { rotate: `${transform.rotation}deg` }, { scale: transform.scale }] }]} />
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="关闭图片" onPress={close} style={styles.close}>
        <Text style={styles.closeText}>×</Text></Pressable>
      <View style={styles.toolbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="缩小图片" style={styles.button}
          onPress={() => setTransform((v) => ({ ...v, scale: clampZoom(v.scale / 1.5) }))}>
          <Text style={styles.label}>−</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="还原图片" style={styles.button}
          onPress={() => setTransform(INITIAL_TRANSFORM)}><Text style={styles.label}>
            {Math.round(transform.scale * 100)}%</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="放大图片" style={styles.button}
          onPress={() => setTransform((v) => ({ ...v, scale: clampZoom(v.scale * 1.5) }))}>
          <Text style={styles.label}>+</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="旋转图片" style={styles.button}
          onPress={() => setTransform((v) => ({ ...v, rotation: (v.rotation + 90) % 360 }))}>
          <Text style={styles.label}>↻</Text></Pressable>
      </View>
      {!image.url && !image.error && <Text style={styles.status}>正在加载原图…</Text>}
      {image.error && <View style={styles.status}><Text style={styles.label}>原图加载失败</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="重新加载原图" onPress={image.retry}>
          <Text style={styles.label}>重试</Text></Pressable></View>}
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(12,14,13,0.96)', alignItems: 'center' },
  stage: { position: 'absolute', top: 80, bottom: 130, width: '100%', overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  close: { position: 'absolute', top: 40, right: 12, width: 44, height: 44, alignItems: 'center' },
  closeText: { color: '#aaa', fontSize: 30 },
  toolbar: { position: 'absolute', bottom: 32, flexDirection: 'row', gap: 12, paddingHorizontal: 12,
    paddingVertical: 4, borderRadius: 28, backgroundColor: '#282b2a' },
  button: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  label: { color: '#ccc', fontSize: 18, textAlign: 'center' },
  status: { position: 'absolute', bottom: 96, color: '#ccc', fontSize: 13, maxWidth: 400, gap: 8 },
});
