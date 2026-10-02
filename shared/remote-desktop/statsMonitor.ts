import type { DesktopStats } from './protocol';
import { DesktopStatsSampler } from './stats';
import type { NativeMediaSession } from './nativeMedia';

const STATS_INTERVAL = 1000;

/** Schedule after completion so slow native stats reads never overlap. */
export function monitorDesktopStats(pc: RTCPeerConnection, publish: (stats: Partial<DesktopStats>) => void,
  nativeMedia?: NativeMediaSession) {
  const sampler = new DesktopStatsSampler(nativeMedia?.endpoint);
  const started = Date.now();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const sample = async () => {
    try {
      const reports = await pc.getStats();
      const stats = sampler.sample(reports);
      if (nativeMedia && stats.nativeMedia) {
        const route = await nativeMedia.status();
        stats.connection = route.direct ? 'direct' : undefined;
        stats.transport = route.protocol === 'tcp' ? 'TCP' : 'UDP'; stats.rttMs = route.rttMs;
      }
      if (!stopped) publish({ ...stats, elapsedSeconds: (Date.now() - started) / 1000 });
    } catch {
      // Stats are optional; a transient read failure must not interrupt video or retain stale measurements.
      if (!stopped) publish({ elapsedSeconds: (Date.now() - started) / 1000 });
    } finally {
      if (!stopped) timer = setTimeout(() => { void sample(); }, STATS_INTERVAL);
    }
  };
  void sample();
  return () => { stopped = true; clearTimeout(timer); };
}
