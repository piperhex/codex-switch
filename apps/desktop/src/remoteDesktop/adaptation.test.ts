import { describe, expect, it } from 'vitest';
import { DesktopAdaptation } from '../../../../shared/remote-desktop/adaptation';
import { DEFAULT_SETTINGS, validateSettings } from '../../../../shared/remote-desktop/protocol';

describe('remote desktop display adaptation', () => {
  it('starts conservatively, immediately reduces load and waits for stable capacity before upgrading', () => {
    const adaptation = new DesktopAdaptation();
    expect(adaptation.profile(DEFAULT_SETTINGS)).toMatchObject({ width: 1280, fps: 24 });
    adaptation.sample({ bitrate: 200_000, rtt: 0.5, loss: 0.08 });
    expect(adaptation.profile(DEFAULT_SETTINGS)).toMatchObject({ width: 854, fps: 12 });
    adaptation.sample({ bitrate: 10_000_000, rtt: 0.02 });
    adaptation.sample({ bitrate: 10_000_000, rtt: 0.02 });
    expect(adaptation.profile(DEFAULT_SETTINGS).width).toBe(854);
    adaptation.sample({ bitrate: 10_000_000, rtt: 0.02 });
    expect(adaptation.profile(DEFAULT_SETTINGS).width).toBe(1280);
  });
  it('preserves a custom frame limit while automatically reducing image size', () => {
    const adaptation = new DesktopAdaptation();
    adaptation.sample({ limited: true });
    expect(adaptation.profile({ quality: 'auto', fps: 45 })).toMatchObject({ width: 854, fps: 45 });
    expect(adaptation.profile({ quality: 'clear', fps: 'auto' })).toMatchObject({ width: 1920, fps: 12 });
  });
  it('does not raise load without measured bandwidth and rejects malformed display settings', () => {
    const adaptation = new DesktopAdaptation();
    for (let index = 0; index < 10; index++) adaptation.sample({});
    expect(adaptation.profile(DEFAULT_SETTINGS).width).toBe(1280);
    for (const fps of [0, -1, 145, 1.5, Infinity, '30', null]) {
      expect(() => validateSettings({ fps, quality: 'auto' })).toThrow();
    }
    expect(() => validateSettings({ fps: 30, quality: 'invalid' })).toThrow();
    expect(validateSettings({ fps: 1, quality: 'smooth' })).toEqual({ fps: 1, quality: 'smooth' });
  });
});
