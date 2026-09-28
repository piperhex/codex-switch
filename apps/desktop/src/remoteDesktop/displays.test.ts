import { expect, it } from 'vitest';
import { DEFAULT_SETTINGS, validateSettings } from '../../../../shared/remote-desktop/protocol';
import { displayLabel } from '../../../../shared/remote-desktop/displays';

it('preserves a selected display through validation and rejects malformed display identifiers', () => {
  const settings = { ...DEFAULT_SETTINGS, displayId: '\\\\.\\DISPLAY2' };
  expect(validateSettings(settings)).toEqual(settings);
  expect(validateSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  for (const displayId of [null, 2, {}, '', 'x'.repeat(129)]) {
    expect(() => validateSettings({ ...DEFAULT_SETTINGS, displayId })).toThrow('显示器');
  }
});

it('labels screens consistently with their Windows number, primary marker and resolution', () => {
  expect(displayLabel({ id: 'screen-2', name: 'DISPLAY2', primary: true, width: 1080, height: 1920 }))
    .toBe('显示器 2 · 主屏 · 1080 × 1920');
});
