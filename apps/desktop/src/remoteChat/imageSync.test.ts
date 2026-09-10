import { beforeEach, expect, it, vi } from 'vitest';
import { RemoteImages } from './images';
import { guiApi } from '../pages/codexGui/api';
import { ImageCache } from '../../../../shared/remote-chat/client/imageCache';
import { contentHash } from '../../../../shared/remote-chat/historySync';

vi.mock('../pages/codexGui/api', () => ({ guiApi: { request: vi.fn() } }));
beforeEach(() => vi.resetAllMocks());

it('replaces inline and generated originals with stable references scoped to the task', async () => {
  const images = new RemoteImages();
  const original = 'data:image/png;base64,' + 'abcd'.repeat(400_000);
  const prepared = images.prepare({ type: 'imageGeneration', result: original.slice(original.indexOf(',') + 1) }, 'task');
  expect(JSON.stringify(prepared).length).toBeLessThan(200);
  expect(images.prepare({ imageUrl: original }, 'task').imageUrl).toBe(prepared.result);
  vi.mocked(guiApi.request).mockResolvedValue({ url: 'data:image/jpeg;base64,YQ==' });
  await images.request({ operation: 'imagePreview', threadId: 'task', source: prepared.result });
  expect(guiApi.request).toHaveBeenCalledWith({ operation: 'imagePreview', threadId: 'task',
    source: original, variant: 'thumbnail' });
  vi.mocked(guiApi.request).mockResolvedValue({ thread: { id: 'other', turns: [] } });
  await expect(images.request({ operation: 'imagePreview', threadId: 'other', source: prepared.result })).rejects.toThrow();
});

it('fetches an original only on demand in bounded chunks, then reuses the cached image', async () => {
  const images = new RemoteImages();
  const original = 'data:image/png;base64,' + 'abcd'.repeat(700_000);
  const thumbnail = 'data:image/jpeg;base64,YQ==';
  vi.mocked(guiApi.request).mockImplementation(async (request) => ({
    url: request.operation === 'imagePreview' && request.variant === 'thumbnail' ? thumbnail : original,
  }));
  const requests: Record<string, unknown>[] = [];
  const cache = new ImageCache(async <T>(body: Record<string, unknown>) => {
    const result = await images.request(body);
    requests.push({ ...body, bytes: JSON.stringify(result).length });
    return result as T;
  });
  expect(await cache.load('task', 'image.png')).toBe(thumbnail);
  expect(requests).toHaveLength(1);
  expect(await cache.load('task', 'image.png', true)).toBe(original);
  const completed = requests.length;
  expect(completed).toBeGreaterThan(10);
  expect(requests.every((request) => Number(request.bytes) < 270_000)).toBe(true);
  expect(await cache.load('task', 'image.png', true)).toBe(original);
  expect(requests).toHaveLength(completed);
  expect(guiApi.request).toHaveBeenCalledTimes(2);
});

it('rejects original chunks from a changed source', async () => {
  let request = 0;
  const cache = new ImageCache(async <T>() => (++request === 1
    ? { data: 'prefix', total: 100, hash: contentHash('first') }
    : { data: 'changed', total: 100, hash: contentHash('second') }) as T);
  await expect(cache.load('task', 'image.png', true)).rejects.toThrow('原图加载中断');
});
