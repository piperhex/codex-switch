import type { RequestSpeed } from './composer';

export const REQUEST_SPEED_LABELS: Record<RequestSpeed, string> = {
  normal: '普通模式', fast: '快速模式', ultrafast: 'Ultrafast 模式',
};
const NEXT_SPEED: Record<RequestSpeed, RequestSpeed> = {
  normal: 'fast', fast: 'ultrafast', ultrafast: 'normal',
};
export const nextRequestSpeed = (speed: RequestSpeed, available = true) => available ? NEXT_SPEED[speed] : 'normal';
export const speedBoltCount = (speed: RequestSpeed) => ({ normal: 0, fast: 1, ultrafast: 2 })[speed];

export function requestSpeedLabel(speed: RequestSpeed, translate = (text: string) => text, available = true) {
  return `${translate(REQUEST_SPEED_LABELS[speed])} · ${translate('点击切换为')}${translate(
    REQUEST_SPEED_LABELS[nextRequestSpeed(speed, available)])}`;
}
