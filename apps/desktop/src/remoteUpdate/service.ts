import type { DesktopUpdateStatus, UpdateAction } from '../../../../shared/desktop-update/protocol';
import { isUpdateBusy } from '../../../../shared/desktop-update/protocol';

interface UpdateInfo { latestVersion: string; releaseNotes?: string | null }
export interface Updater {
  check: () => Promise<UpdateInfo | null>;
  download: (progress: (value: number | null) => void) => Promise<void>;
  install: (version: string) => Promise<void>;
}

/** All remote sessions share one updater; a repeated install never starts a second download. */
export class RemoteUpdateService {
  private state: DesktopUpdateStatus;
  constructor(version: string, private readonly updater: Updater) {
    this.state = { currentVersion: version, latestVersion: null, notes: null,
      phase: 'idle', progress: null, error: null };
  }

  async request(action: UpdateAction, version?: string | null): Promise<DesktopUpdateStatus> {
    if (action === 'status' || isUpdateBusy(this.state)) return this.snapshot();
    if (action === 'check') return this.check();
    if (action !== 'install' || !version || version !== this.state.latestVersion) {
      throw new Error('请先检查更新，再确认要安装的版本。');
    }
    this.state = { ...this.state, phase: 'downloading', progress: null, error: null };
    // Acknowledge the command immediately; subsequent status requests observe the background work.
    void this.install(version);
    return this.snapshot();
  }

  private snapshot(): DesktopUpdateStatus { return { ...this.state }; }

  private async check() {
    this.state = { ...this.state, phase: 'checking', error: null };
    try {
      const update = await this.updater.check();
      this.state = { ...this.state, latestVersion: update?.latestVersion ?? null,
        notes: update?.releaseNotes?.slice(0, 12_000) ?? null,
        phase: update ? 'available' : 'idle', progress: null };
    } catch {
      this.fail('检查更新失败，请稍后重试。');
    }
    return this.snapshot();
  }

  private async install(version: string) {
    try {
      const update = await this.updater.check();
      if (!update || update.latestVersion !== version) {
        this.state = { ...this.state, latestVersion: update?.latestVersion ?? null,
          notes: update?.releaseNotes?.slice(0, 12_000) ?? null };
        this.fail('可安装的版本已变化，请重新检查更新。');
        return;
      }
      await this.updater.download((progress) => { this.state = { ...this.state, progress }; });
      this.state = { ...this.state, phase: 'installing', progress: 100 };
      await this.updater.install(version);
    } catch {
      this.fail('安装更新失败，请稍后重试。');
    }
  }

  private fail(error: string) { this.state = { ...this.state, phase: 'error', error }; }
}
