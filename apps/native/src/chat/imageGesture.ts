import { moveImage, type ImageTransform, type Point } from '../../../../shared/chat/imageTransform';

const TAP_DISTANCE = 8;
const TAP_DURATION_MS = 250;

export interface ImageGestureTouch extends Point { identifier: string }
export interface ImageGestureState {
  transform: ImageTransform;
  anchor: { before: ImageTransform; start: ImageGestureTouch[] };
  origin: ImageGestureTouch | undefined;
  started: number;
  moved: boolean;
  pinched: boolean;
}

function isTapPosition(origin: ImageGestureTouch | undefined, touches: ImageGestureTouch[]): boolean {
  const touch = touches[0];
  return !!origin && touches.length === 1 && touch.identifier === origin.identifier
    && Math.hypot(touch.x - origin.x, touch.y - origin.y) <= TAP_DISTANCE;
}

export function beginImageGesture(
  transform: ImageTransform, touches: ImageGestureTouch[], started: number,
): ImageGestureState {
  return { transform, anchor: { before: transform, start: touches }, origin: touches[0],
    started, moved: touches.length !== 1, pinched: touches.length > 1 };
}

export function updateImageGesture(state: ImageGestureState, touches: ImageGestureTouch[]): ImageGestureState {
  const sameTouches = touches.length === state.anchor.start.length
    && state.anchor.start.every((before) => touches.some((touch) => touch.identifier === before.identifier));
  // Rebase as fingers join or leave, using the latest transform even before React renders it.
  const anchor = sameTouches ? state.anchor : { before: state.transform, start: touches };
  return { ...state, anchor, transform: moveImage({ ...anchor, current: touches }),
    moved: state.moved || !isTapPosition(state.origin, touches), pinched: state.pinched || touches.length > 1 };
}

export function isImageGestureTap(
  state: ImageGestureState | null, released: ImageGestureTouch[], ended: number, closeBlockedUntil = 0,
): boolean {
  return !!state && !state.moved && state.started >= closeBlockedUntil && ended - state.started <= TAP_DURATION_MS
    && isTapPosition(state.origin, released);
}
