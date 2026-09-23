import type { Update } from "@tauri-apps/plugin-updater";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { checkAvailableAppUpdate, UPDATE_CHECK_DEADLINE_MS } from "./appUpdateCheck";
import { AppUpdateCheckTimeoutError } from "./appUpdateErrors";

const updater = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: updater.check }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  updater.check.mockReset();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("sets a native request timeout and clears the deadline after a successful check", async () => {
  updater.check.mockResolvedValue(null);
  await expect(checkAvailableAppUpdate()).resolves.toBeNull();
  expect(updater.check).toHaveBeenCalledWith({ timeout: 10_000 });
  expect(vi.getTimerCount()).toBe(0);
});

it("retries a transient network failure within the deadline", async () => {
  updater.check.mockRejectedValueOnce(new Error("error sending request")).mockResolvedValueOnce(null);
  const checking = checkAvailableAppUpdate();
  await vi.advanceTimersByTimeAsync(500);
  await expect(checking).resolves.toBeNull();
  expect(updater.check).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it("reports native request timeouts after exhausting retries", async () => {
  updater.check.mockRejectedValue(new Error("operation timed out"));
  const result = expect(checkAvailableAppUpdate()).rejects.toBeInstanceOf(AppUpdateCheckTimeoutError);
  await vi.advanceTimersByTimeAsync(2_000);
  await result;
  expect(updater.check).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});

it("does not retry invalid update metadata", async () => {
  updater.check.mockRejectedValue(new Error("invalid release JSON"));
  await expect(checkAvailableAppUpdate()).rejects.toThrow("invalid release JSON");
  expect(updater.check).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("times out even when the native check never settles", async () => {
  updater.check.mockReturnValue(new Promise(() => undefined));
  const failed = vi.fn();
  const checking = checkAvailableAppUpdate().catch(failed);
  await vi.advanceTimersByTimeAsync(UPDATE_CHECK_DEADLINE_MS - 1);
  expect(failed).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await checking;
  expect(failed).toHaveBeenCalledWith(expect.any(AppUpdateCheckTimeoutError));
  expect(updater.check).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("includes retry waiting in the total deadline", async () => {
  const firstAttempt = deferred<null>();
  updater.check.mockReturnValueOnce(firstAttempt.promise);
  const result = expect(checkAvailableAppUpdate()).rejects.toBeInstanceOf(AppUpdateCheckTimeoutError);
  await vi.advanceTimersByTimeAsync(UPDATE_CHECK_DEADLINE_MS - 100);
  firstAttempt.reject(new Error("network unavailable"));
  await vi.advanceTimersByTimeAsync(500);
  await result;
  expect(updater.check).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("closes a resource that arrives after the deadline", async () => {
  const pending = deferred<Pick<Update, "close">>();
  const lateUpdate = { close: vi.fn(async () => undefined) };
  updater.check.mockReturnValue(pending.promise);
  const result = expect(checkAvailableAppUpdate()).rejects.toBeInstanceOf(AppUpdateCheckTimeoutError);
  await vi.advanceTimersByTimeAsync(UPDATE_CHECK_DEADLINE_MS);
  await result;
  pending.resolve(lateUpdate);
  await vi.advanceTimersByTimeAsync(0);
  expect(lateUpdate.close).toHaveBeenCalledOnce();
  expect(updater.check).toHaveBeenCalledOnce();
});

it("does not retry a network failure that arrives after the deadline", async () => {
  const pending = deferred<null>();
  updater.check.mockReturnValue(pending.promise);
  const result = expect(checkAvailableAppUpdate()).rejects.toBeInstanceOf(AppUpdateCheckTimeoutError);
  await vi.advanceTimersByTimeAsync(UPDATE_CHECK_DEADLINE_MS);
  await result;
  pending.reject(new Error("network unavailable"));
  await vi.advanceTimersByTimeAsync(2_000);
  expect(updater.check).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
