import { expect, it } from 'vitest';
import { composerPatch, DEFAULT_COMPOSER } from '../../../../shared/remote-chat/composer';
import { settingOptions, settingValue, visibleSettingsFields } from '../../../../shared/remote-chat/settingsMenu';

it('validates speed choices and hides unsupported controls for older hosts', () => {
  expect(composerPatch({ speed: 'fast' })).toEqual({ speed: 'fast' });
  expect(composerPatch({ speed: 'normal' })).toEqual({ speed: 'normal' });
  for (const speed of ['priority', '', true, null, 1]) expect(() => composerPatch({ speed })).toThrow();
  expect(visibleSettingsFields(DEFAULT_COMPOSER).some(({ field }) => field === 'speed')).toBe(false);
  const selection = { ...DEFAULT_COMPOSER, speed: 'normal' as const };
  expect(visibleSettingsFields(selection).some(({ field }) => field === 'speed')).toBe(true);
  expect(settingOptions('speed', [], selection).map(({ label }) => label)).toEqual(['普通模式', '快速模式']);
  expect(settingValue('speed', [], selection)).toBe('普通模式');
});
