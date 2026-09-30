import { afterEach, expect, it, vi } from "vitest";
import { websitePreviewApi, websitePreviewSession } from "./websiteApi";

afterEach(() => vi.restoreAllMocks());

it("releases a partially created view after failure and waits for an explicit retry", async () => {
  const sync = vi.spyOn(websitePreviewApi, "sync").mockRejectedValue(new Error("Unavailable"));
  const close = vi.spyOn(websitePreviewApi, "close").mockResolvedValue();
  const onError = vi.fn();
  const session = websitePreviewSession(onError);
  const request = { url: "https://example.com", bounds: { x: 100, y: 80, width: 600, height: 700 }, visible: true };
  session.update(request);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(onError).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledWith(sync.mock.calls[0][0].id);
  session.update(request);
  expect(sync).toHaveBeenCalledOnce();
  await session.close();
});

it("coalesces bounds updates and waits for creation before closing", async () => {
  let finish!: () => void;
  const sync = vi.spyOn(websitePreviewApi, "sync").mockReturnValueOnce(new Promise(done => { finish = done; }))
    .mockResolvedValue();
  const close = vi.spyOn(websitePreviewApi, "close").mockResolvedValue();
  const session = websitePreviewSession(vi.fn());
  const request = { url: "https://example.com", bounds: { x: 100, y: 80, width: 600, height: 700 }, visible: true };
  session.update(request);
  session.update({ ...request, bounds: { ...request.bounds, width: 700 } });
  session.update({ ...request, visible: false });
  expect(sync).toHaveBeenCalledOnce();
  const closing = session.close();
  expect(close).not.toHaveBeenCalled();
  finish(); await closing;
  expect(sync).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledWith(sync.mock.calls[0][0].id);
  session.update(request);
  expect(sync).toHaveBeenCalledOnce();
});

it("applies only the latest pending resize after the in-flight request", async () => {
  let finish!: () => void;
  const sync = vi.spyOn(websitePreviewApi, "sync").mockReturnValueOnce(new Promise(done => { finish = done; }))
    .mockResolvedValue();
  vi.spyOn(websitePreviewApi, "close").mockResolvedValue();
  const session = websitePreviewSession(vi.fn());
  const request = { url: "https://example.com", bounds: { x: 100, y: 80, width: 600, height: 700 }, visible: true };
  session.update(request);
  session.update({ ...request, bounds: { ...request.bounds, width: 700 } });
  session.update({ ...request, visible: false });
  finish(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(sync).toHaveBeenCalledTimes(2);
  expect(sync).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false }));
  await session.close();
});
