import { expect, it, vi } from 'vitest';
import { RemoteUpdateService, type Updater } from './service';

function updater() {
  return { check: vi.fn<Updater['check']>().mockResolvedValue({ latestVersion: '2.0.0', releaseNotes: 'Changes' }),
    download: vi.fn<Updater['download']>().mockResolvedValue(undefined),
    install: vi.fn<Updater['install']>().mockResolvedValue(undefined) };
}
const flush = async () => { for (let count = 0; count < 8; count++) await Promise.resolve(); };

it('reads the running version without checking releases and prevents installation before a check', async () => {
  const api = updater(); const service = new RemoteUpdateService('1.0.0', api);
  expect(await service.request('status')).toMatchObject({ currentVersion: '1.0.0', phase: 'idle' });
  expect(api.check).not.toHaveBeenCalled();
  await expect(service.request('install', '2.0.0')).rejects.toThrow();
  expect(api.install).not.toHaveBeenCalled();
});

it('acknowledges download once, keeps status responsive and installs only the confirmed version', async () => {
  const api = updater(); let downloaded!: () => void;
  api.download.mockImplementation((progress) => {
    progress(42); return new Promise<void>((resolve) => { downloaded = resolve; });
  });
  const service = new RemoteUpdateService('1.0.0', api);
  await service.request('check');
  expect(await service.request('install', '2.0.0')).toMatchObject({ phase: 'downloading' });
  await flush();
  expect(await service.request('status')).toMatchObject({ phase: 'downloading', progress: 42 });
  await service.request('install', '2.0.0');
  expect(api.download).toHaveBeenCalledOnce();
  downloaded(); await flush();
  expect(api.install).toHaveBeenCalledExactlyOnceWith('2.0.0');
  expect(await service.request('status')).toMatchObject({ phase: 'installing' });
});

it('requires a fresh confirmation if a newer version appears before download', async () => {
  const api = updater(); const service = new RemoteUpdateService('1.0.0', api);
  await service.request('check');
  api.check.mockResolvedValue({ latestVersion: '3.0.0' });
  await service.request('install', '2.0.0'); await flush();
  expect(await service.request('status')).toMatchObject({ phase: 'error', latestVersion: '3.0.0' });
  expect(api.download).not.toHaveBeenCalled();
  expect(api.install).not.toHaveBeenCalled();
});

it('reports safe download errors and permits retry without leaking private details', async () => {
  const api = updater(); const service = new RemoteUpdateService('1.0.0', api);
  await service.request('check');
  api.download.mockRejectedValueOnce(new Error('private filesystem and credentials'));
  await service.request('install', '2.0.0'); await flush();
  expect(await service.request('status')).toMatchObject({ phase: 'error', error: '安装更新失败，请稍后重试。' });
  await service.request('install', '2.0.0'); await flush();
  expect(api.install).toHaveBeenCalledOnce();
});

it('serializes checks and reports no update without an install option', async () => {
  const api = updater(); let checked!: (value: null) => void;
  api.check.mockImplementation(() => new Promise((resolve) => { checked = resolve; }));
  const service = new RemoteUpdateService('1.0.0', api);
  const checking = service.request('check');
  expect(await service.request('check')).toMatchObject({ phase: 'checking' });
  expect(api.check).toHaveBeenCalledOnce();
  checked(null); await checking;
  expect(await service.request('status')).toMatchObject({ phase: 'idle', latestVersion: null });
});
