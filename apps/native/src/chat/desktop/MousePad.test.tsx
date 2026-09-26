import { createRequire, Module } from 'node:module';
import React, { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DesktopMouse } from './MousePad';
import { DesktopPointer } from '../../../../../shared/remote-desktop/input';
import { desktopViewport } from '../../../../../shared/remote-desktop/geometry';

vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot() }));
vi.mock('react-native', () => ({ View: 'View', Image: 'Image', Pressable: 'Pressable', Text: 'Text',
  StyleSheet: { create: <T,>(styles: T) => styles, absoluteFillObject: { position: 'absolute' } } }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon', MaterialCommunityIcons: 'Icon' }));
interface Props { children?: ReactNode; style?: Array<{ left?: number; top?: number; width?: number; height?: number }>;
  accessibilityLabel?: string; pointerEvents?: string; onPress?: () => void }
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
  expect(style.width).toBe(176); expect(style.height).toBe(160);
  expect(style.top! + style.height!).toBeGreaterThan(viewport.content.y + viewport.content.height);
  panel.expanded = false;
  const icon = render().find(node => node.props.accessibilityLabel === '展开鼠标面板')!;
  icon.props.onPress!(); expect(panel.expand).toHaveBeenCalledOnce();
  expect(nodes(DesktopMouse({ pointer, viewport, panel, visible: false, wheel: vi.fn() }))
    .some(node => node.props.pointerEvents === 'box-none')).toBe(false);
  pointer.dispose();
});
