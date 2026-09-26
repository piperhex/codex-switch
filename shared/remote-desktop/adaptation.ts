import type { DesktopSettings } from './protocol';

export interface NetworkSample { bitrate?: number; rtt?: number; loss?: number; limited?: boolean }
export const PROFILES = [
  { width: 854, fps: 12, bitrate: 600_000 },
  { width: 1280, fps: 24, bitrate: 1_800_000 },
  { width: 1920, fps: 30, bitrate: 4_000_000 },
  { width: 2560, fps: 60, bitrate: 8_000_000 },
] as const;

/** Downshift promptly; wait for three healthy samples before increasing load. */
export class DesktopAdaptation {
  private level = 1;
  private healthy = 0;
  sample(sample: NetworkSample) {
    const current = PROFILES[this.level];
    const congested = (sample.rtt ?? 0) > 0.3 || (sample.loss ?? 0) > 0.05 || sample.limited
      || (sample.bitrate !== undefined && sample.bitrate < current.bitrate * 0.85);
    if (congested) { this.level = Math.max(0, this.level - 1); this.healthy = 0; return; }
    const next = PROFILES[Math.min(PROFILES.length - 1, this.level + 1)];
    const healthy = sample.bitrate !== undefined && sample.bitrate > next.bitrate * 1.25
      && (sample.rtt ?? 0) < 0.15 && (sample.loss ?? 0) < 0.01;
    this.healthy = healthy ? this.healthy + 1 : 0;
    if (this.healthy >= 3) { this.level = Math.min(PROFILES.length - 1, this.level + 1); this.healthy = 0; }
  }
  profile(settings: DesktopSettings) {
    const qualityLevel = { smooth: 0, clear: 2, original: 3 };
    const quality = settings.quality === 'auto' ? this.level : qualityLevel[settings.quality];
    const profile = PROFILES[quality];
    return { ...profile, fps: settings.fps === 'auto' ? PROFILES[this.level].fps : settings.fps };
  }
}
