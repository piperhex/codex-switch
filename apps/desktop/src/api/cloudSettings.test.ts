// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
const fetcher = vi.fn();
const title = { model: 'gpt-6-luna', effort: 'low' };
const presets = [{ id: 'work', name: 'Work', path: 'C:\\Codex' }];

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  document.head.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal('fetch', fetcher);
  Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Win32' });
});

afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  document.head.innerHTML = '';
  vi.unstubAllGlobals();
});

function desktop() {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
  fetcher.mockRejectedValue(new TypeError('Blocked by desktop Content Security Policy'));
}

it('loads desktop naming settings and home presets even when WebView fetch is blocked', async () => {
  desktop();
  native.invoke.mockResolvedValueOnce(title).mockResolvedValueOnce(presets);
  const { fetchCloudTitleSettings } = await import('./cloudTitleSettings');
  const { loadCodexHomePresets } = await import('./backend');
  expect(await fetchCloudTitleSettings()).toEqual(title);
  expect(await loadCodexHomePresets('https://configured.test')).toEqual(presets);
  expect(native.invoke.mock.calls).toEqual([
    ['fetch_cloud_title_settings', {}],
    ['fetch_cloud_home_presets', { baseUrl: 'https://configured.test', platform: 'windows' }],
  ]);
  expect(fetcher).not.toHaveBeenCalled();
});

it('waits for native settings without blocking other work, and uses them for title generation', async () => {
  desktop();
  let complete!: (value: unknown) => void;
  native.invoke.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
  const { GuiTitleSettings } = await import('../pages/codexGui/titleSettings');
  const settings = new GuiTitleSettings();
  const refreshing = settings.refresh();
  const snapshot = settings.snapshot();
  await new Promise((resolve) => setTimeout(resolve, 0));
  complete(title);
  await refreshing;
  expect(await snapshot).toEqual(title);
  expect(fetcher).not.toHaveBeenCalled();
});

it('retains valid desktop settings on request failures or malformed responses', async () => {
  desktop();
  const { GuiTitleSettings } = await import('../pages/codexGui/titleSettings');
  const settings = new GuiTitleSettings();
  native.invoke.mockRejectedValueOnce(new Error('Unavailable'));
  await settings.refresh();
  expect(await settings.snapshot()).toEqual({ model: 'gpt-5.6-luna', effort: 'low' });
  native.invoke.mockResolvedValueOnce(title);
  await settings.refresh();
  native.invoke.mockResolvedValueOnce({ model: 'bad model', effort: 'wrong' });
  await settings.refresh();
  expect(await settings.snapshot()).toEqual(title);
  expect(fetcher).not.toHaveBeenCalled();
});

it('routes hosted requests through the authenticated local backend', async () => {
  document.head.innerHTML = '<meta name="codex-switch-runtime" content="hosted">';
  sessionStorage.setItem('codex-switch:hosted-web-api-key', 'test-key');
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: title })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: presets })));
  const { fetchCloudTitleSettings } = await import('./cloudTitleSettings');
  const { loadCodexHomePresets } = await import('./backend');
  expect(await fetchCloudTitleSettings()).toEqual(title);
  expect(await loadCodexHomePresets('https://configured.test')).toEqual(presets);
  expect(fetcher.mock.calls.map(([url, options]) => ({ url, ...JSON.parse(options.body) }))).toEqual([
    { url: '/__codex_switch__/api/invoke', command: 'fetch_cloud_title_settings', args: {} },
    { url: '/__codex_switch__/api/invoke', command: 'fetch_cloud_home_presets',
      args: { baseUrl: 'https://configured.test', platform: 'windows' } },
  ]);
  expect(fetcher.mock.calls.every(([, options]) => options.headers['X-API-Key'] === 'test-key')).toBe(true);
  expect(native.invoke).not.toHaveBeenCalled();
});

it('keeps direct requests for browser previews and preserves custom server prefixes and platform', async () => {
  localStorage.setItem('codex-switch:cloud-base-url', 'https://configured.test/api/');
  Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' });
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify(title)))
    .mockResolvedValueOnce(new Response(JSON.stringify(presets)));
  const { fetchCloudTitleSettings } = await import('./cloudTitleSettings');
  const { loadCodexHomePresets } = await import('./backend');
  expect(await fetchCloudTitleSettings()).toEqual(title);
  expect(await loadCodexHomePresets('https://configured.test/api/')).toEqual(presets);
  expect(fetcher).toHaveBeenNthCalledWith(1, 'https://configured.test/api/chat/title-settings',
    expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }));
  expect(fetcher).toHaveBeenNthCalledWith(2, 'https://configured.test/api/codex-home-presets?platform=macos',
    expect.objectContaining({ cache: 'no-store' }));
  expect(native.invoke).not.toHaveBeenCalled();
});
