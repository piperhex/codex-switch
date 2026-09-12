import { expect, it } from 'vitest';
import { INITIAL_TRANSFORM } from '../../../../shared/chat/imageTransform';
import { beginImageGesture, isImageGestureTap, updateImageGesture, type ImageGestureTouch } from './imageGesture';

const touch = (x: number, y: number, identifier = '1'): ImageGestureTouch => ({ x, y, identifier });

it.each([1, 3])('preserves deliberate single-tap close at scale %s', (scale) => {
  const gesture = beginImageGesture({ ...INITIAL_TRANSFORM, scale }, [touch(100, 200)], 1000);
  expect(isImageGestureTap(gesture, [touch(102, 203)], 1100)).toBe(true);
});

it.each([-400, 1000])('keeps a zoomed image open after dragging beyond the stage to y=%s', (y) => {
  let gesture = beginImageGesture({ ...INITIAL_TRANSFORM, scale: 3 }, [touch(100, 200)], 1000);
  gesture = updateImageGesture(gesture, [touch(100, y)]);
  expect(gesture.transform.y).toBe(y - 200);
  expect(isImageGestureTap(gesture, [touch(100, y)], 1100)).toBe(false);
});

it('does not close when a drag returns to its original position before release', () => {
  let gesture = beginImageGesture(INITIAL_TRANSFORM, [touch(100, 200)], 1000);
  gesture = updateImageGesture(gesture, [touch(100, 300)]);
  gesture = updateImageGesture(gesture, [touch(100, 200)]);
  expect(isImageGestureTap(gesture, [touch(100, 200)], 1100)).toBe(false);
});

it('does not mistake a pinch with a stationary midpoint for a tap', () => {
  let gesture = beginImageGesture(INITIAL_TRANSFORM, [touch(100, 200)], 1000);
  gesture = updateImageGesture(gesture, [touch(100, 200), touch(200, 200, '2')]);
  gesture = updateImageGesture(gesture, [touch(50, 200), touch(250, 200, '2')]);
  gesture = updateImageGesture(gesture, [touch(50, 200)]);
  expect(gesture.transform).toEqual({ ...INITIAL_TRANSFORM, scale: 2 });
  expect(isImageGestureTap(gesture, [touch(50, 200)], 1100)).toBe(false);
});

it('keeps a brief second finger from turning into a close after it lifts', () => {
  let gesture = beginImageGesture(INITIAL_TRANSFORM, [touch(100, 200)], 1000);
  gesture = updateImageGesture(gesture, [touch(100, 200), touch(200, 200, '2')]);
  gesture = updateImageGesture(gesture, [touch(100, 200)]);
  expect(isImageGestureTap(gesture, [touch(100, 200)], 1100)).toBe(false);
});

it('continues panning immediately after fingers join or leave without jumping or losing zoom', () => {
  let gesture = beginImageGesture(INITIAL_TRANSFORM, [touch(100, 200)], 1000);
  gesture = updateImageGesture(gesture, [touch(150, 300)]);
  gesture = updateImageGesture(gesture, [touch(150, 300), touch(250, 300, '2')]);
  gesture = updateImageGesture(gesture, [touch(100, 300), touch(300, 300, '2')]);
  expect(gesture.transform).toEqual({ ...INITIAL_TRANSFORM, scale: 2, x: 50, y: 100 });
  gesture = updateImageGesture(gesture, [touch(300, 300, '2')]);
  gesture = updateImageGesture(gesture, [touch(310, 350, '2')]);
  expect(gesture.transform).toEqual({ ...INITIAL_TRANSFORM, scale: 2, x: 60, y: 150 });
});

it('checks the release position even when the final move event was not delivered', () => {
  const gesture = beginImageGesture(INITIAL_TRANSFORM, [touch(100, 200)], 1000);
  expect(isImageGestureTap(gesture, [touch(100, 600)], 1100)).toBe(false);
});

it('does not close for a replaced finger, a held touch, or a cancelled gesture', () => {
  const gesture = beginImageGesture(INITIAL_TRANSFORM, [touch(100, 200)], 1000);
  expect(isImageGestureTap(gesture, [touch(100, 200, '2')], 1100)).toBe(false);
  expect(isImageGestureTap(gesture, [touch(100, 200)], 1500)).toBe(false);
  expect(isImageGestureTap(null, [touch(100, 200)], 1100)).toBe(false);
});
