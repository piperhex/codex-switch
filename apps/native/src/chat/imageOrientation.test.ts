import { expect, it } from 'vitest';
import { imageOrientation } from './imageOrientation';

it.each([
  [{ x: 0, y: 1, z: 0 }, 'portrait'],
  [{ x: 0, y: -1, z: 0 }, 'portrait-down'],
  [{ x: 1, y: 0, z: 0 }, 'landscape-right'],
  [{ x: -1, y: 0, z: 0 }, 'landscape-left'],
] as const)('detects physical orientation independently of the screen lock: %o', (gravity, expected) => {
  expect(imageOrientation(gravity, 'android')).toBe(expected);
  expect(imageOrientation({ x: -gravity.x, y: -gravity.y, z: -gravity.z }, 'ios')).toBe(expected);
});

it('does not suggest a direction while the phone is flat or between orientations', () => {
  for (const gravity of [{ x: 0.1, y: 0.1, z: 1 }, { x: 0.7, y: 0.7, z: 0 },
    { x: -0.7, y: 0.7, z: 0 }, { x: 0, y: 0, z: 0 }]) {
    expect(imageOrientation(gravity, 'android')).toBeNull();
  }
});
