import { createRequire, Module } from 'node:module';
import React, { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Image } from 'react-native';
import { DesktopMouse } from './MousePad';
import { DesktopPointer } from '../../../../../shared/remote-desktop/input';
import { desktopViewport } from '../../../../../shared/remote-desktop/geometry';

vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot() }));
vi.mock('react-native', () => ({ View: 'View', Image: 'Image', Pressable: 'Pressable', Text: 'Text',
  StyleSheet: { create: <T,>(styles: T) => styles, absoluteFillObject: { position: 'absolute' } } }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon', MaterialCommunityIcons: 'Icon' }));
interface Props { children?: ReactNode; style?: Array<{ left?: number; top?: number; width?: number; height?: number }>;
  accessibilityLabel?: string; pointerEvents?: string; onPress?: () => void; resizeMode?: string }
function nodes(tree: ReactNode): ReactElement<Props>[] {
  return Children.toArray(tree).flatMap(child => isValidElement<Props>(child)
    ? [child, ...nodes(child.props.children)] : []);
}

const assetRequire = createRequire(import.meta.url);
const cursorAsset = assetRequire.resolve('../../../../../shared/remote-desktop/cursor.png');
const previousAsset = assetRequire.cache[cursorAsset];
beforeEach(() => {
  vi.stubGlobal('React', React);
  // Metro loads this file as an asset identifier, not as JavaScript.
  const asset = new Module(cursorAsset); asset.exports = 1; assetRequire.cache[cursorAsset] = asset;
});
afterEach(() => {
  if (previousAsset) assetRequire.cache[cursorAsset] = previousAsset; else delete assetRequire.cache[cursorAsset];
  vi.unstubAllGlobals();
});

it('renders the native local pointer and small controls over black letterboxing, then a tappable idle icon', () => {
  const pointer = new DesktopPointer(vi.fn()); pointer.absolute(0.4, 1);
  const viewport = desktopViewport({ width: 400, height: 800 }, { width: 1600, height: 900 });
  const panel = { expanded: true, expand: vi.fn(), collapse: vi.fn(), activity: vi.fn(), hold: vi.fn() };
  const render = () => nodes(DesktopMouse({ pointer, viewport, panel, visible: true, wheel: vi.fn() }));
  const elements = render();
  const cursor = elements.find(node => node.props.pointerEvents === 'none')!;
  expect(cursor.props.style?.[1].left).toBeCloseTo(159.6);
  expect(cursor.props.style?.[1].top).toBe(511.5);
  const controls = elements.find(node => node.props.pointerEvents === 'box-none')!;
  const style = Object.assign({}, ...controls.props.style!);
  expect(style.width).toBe(152); expect(style.height).toBe(136);
  expect(style.left).toBeCloseTo(159.6 + 24); expect(style.top).toBe(511.5);
  const image = elements.find(node => node.type === Image)!;
  // RN prepends the asset's 72 × 96 dimensions; the Image itself must override them.
  expect(image.props.style).toEqual({ width: 18, height: 24 });
  expect(image.props.resizeMode).toBe('contain');
  expect(style.top! + style.height!).toBeGreaterThan(viewport.content.y + viewport.content.height);
  panel.expanded = false;
  const collapsed = render();
  const icon = collapsed.find(node => node.props.accessibilityLabel === '展开鼠标面板')!;
  const iconStyle = Object.assign({}, ...collapsed.find(node => node.props.pointerEvents === 'box-none')!.props.style!);
  expect(iconStyle).toMatchObject({ left: style.left, top: style.top, width: 40, height: 40 });
  icon.props.onPress!(); expect(panel.expand).toHaveBeenCalledOnce();
  expect(nodes(DesktopMouse({ pointer, viewport, panel, visible: false, wheel: vi.fn() }))
    .some(node => node.props.pointerEvents === 'box-none')).toBe(false);
  pointer.dispose();
});

it('keeps the native cursor and panel offset together at the screen edges', () => {
  const pointer = new DesktopPointer(vi.fn());
  const panel = { expanded: true, expand: vi.fn(), collapse: vi.fn(), activity: vi.fn(), hold: vi.fn() };
  for (const stage of [{ width: 390, height: 750 }, { width: 774, height: 390 }]) {
    const viewport = desktopViewport(stage, { width: 1600, height: 900 });
    for (const point of [{ x: 0, y: 0 }, { x: 0.7, y: 0.8 }, { x: 1, y: 1 }]) {
      pointer.absolute(point.x, point.y);
      const elements = nodes(DesktopMouse({ pointer, viewport, panel, visible: true, wheel: vi.fn() }));
      const cursor = Object.assign({}, ...elements.find(node => node.props.pointerEvents === 'none')!.props.style!);
      const controls = Object.assign({}, ...elements.find(node => node.props.pointerEvents === 'box-none')!.props.style!);
      expect(controls.left! - cursor.left!).toBeCloseTo(24);
      expect(controls.top).toBe(cursor.top);
      expect(cursor.width).toBe(18); expect(cursor.height).toBe(24);
    }
  }
  pointer.dispose();
});
