import type { DesktopDisplay } from './protocol';

export function displayLabel(display: DesktopDisplay, translate: (text: string) => string = text => text) {
  const number = display.name.replace(/^DISPLAY(\d+)$/i, '$1');
  const primary = display.primary ? ` · ${translate('主屏')}` : '';
  return `${translate('显示器')} ${number}${primary} · ${display.width} × ${display.height}`;
}
