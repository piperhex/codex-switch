import type { DesktopDisplay } from './protocol';

export function displayName(display: DesktopDisplay, translate: (text: string) => string = text => text) {
  const number = display.name.replace(/^DISPLAY(\d+)$/i, '$1');
  return `${translate('显示器')} ${number}`;
}

export function displayLabel(display: DesktopDisplay, translate: (text: string) => string = text => text) {
  const primary = display.primary ? ` · ${translate('主屏')}` : '';
  return `${displayName(display, translate)}${primary} · ${display.width} × ${display.height}`;
}
