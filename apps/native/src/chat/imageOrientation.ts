export type ImageOrientation = 'portrait' | 'portrait-down' | 'landscape-left' | 'landscape-right';
interface Gravity { x: number; y: number; z: number }
const MIN_UPRIGHT_GRAVITY = 0.65;
const AXIS_MARGIN = 0.25;

/** Ignore flat phones and diagonal positions so the rotate suggestion stays stable. */
export function imageOrientation(gravity: Gravity, platform: string): ImageOrientation | null {
  // Core Motion reports gravity with the opposite sign to Android's accelerometer.
  const sign = platform === 'ios' ? -1 : 1;
  const x = gravity.x * sign;
  const y = gravity.y * sign;
  if (Math.max(Math.abs(x), Math.abs(y)) < MIN_UPRIGHT_GRAVITY) return null;
  if (Math.abs(x) > Math.abs(y) + AXIS_MARGIN) return x > 0 ? 'landscape-right' : 'landscape-left';
  if (Math.abs(y) > Math.abs(x) + AXIS_MARGIN) return y > 0 ? 'portrait' : 'portrait-down';
  return null;
}
