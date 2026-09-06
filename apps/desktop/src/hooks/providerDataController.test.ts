import { describe, expect, it, vi } from "vitest";
import type { LocalProxyStatus, Provider } from "../types";
import { ProviderDataController } from "./providerDataController";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
}

function proxy(running: boolean): LocalProxyStatus {
  return {
    running, fastModeEnabled: false, fastModeAvailable: true,
    address: "127.0.0.1", port: 1234, baseUrl: "http://127.0.0.1:1234",
    autoSwitchOnQuotaExhaustion: false, concurrentAccountRoutingEnabled: false,
    customAutoSwitchPriorityEnabled: false, customAutoSwitchThresholdEnabled: false,
    globalAutoSwitchThreshold: 0, autoDisableUnreachableAccounts: false,
    systemPromptFilterEnabled: false, systemPromptFilterRules: [],
    systemPromptInjectionEnabled: false, systemPromptInjectionPrompts: [],
    listenOnAllInterfaces: false, hasLanApiKey: false,
  };
}

function createController() {
  const dependencies = {
    loadProviders: vi.fn<() => Promise<Provider[]>>().mockResolvedValue([]),
    loadAggregateApis: vi.fn().mockResolvedValue([]),
    loadLocalProxyStatus: vi.fn().mockResolvedValue(proxy(false)),
    onSnapshot: vi.fn(), onLocalProxyStatus: vi.fn(), onError: vi.fn(), onSettled: vi.fn(),
  };
  const controller = new ProviderDataController(dependencies);
  controller.activate();
  return { controller, ...dependencies };
}

describe("Provider refresh ordering", () => {
  it("coalesces a burst into one trailing read and keeps setters waiting for the new state", async () => {
    const context = createController();
    const beforeSetting = deferred<LocalProxyStatus>();
    const afterSetting = deferred<LocalProxyStatus>();
    context.loadLocalProxyStatus.mockReturnValueOnce(beforeSetting.promise).mockReturnValueOnce(afterSetting.promise);
    const initial = context.controller.refresh();
    let setterFinished = false;
    const setter = context.controller.refresh().then(() => { setterFinished = true; });
    context.controller.refresh();
    context.controller.refresh();
    expect(context.loadLocalProxyStatus).toHaveBeenCalledOnce();

    beforeSetting.resolve(proxy(false));
    await vi.waitFor(() => expect(context.loadLocalProxyStatus).toHaveBeenCalledTimes(2));
    expect(context.onSnapshot).not.toHaveBeenCalled();
    expect(setterFinished).toBe(false);
    afterSetting.resolve(proxy(true));
    await Promise.all([initial, setter]);

    expect(context.loadProviders).toHaveBeenCalledTimes(2);
    expect(context.loadAggregateApis).toHaveBeenCalledTimes(2);
    expect(context.onSnapshot).toHaveBeenCalledOnce();
    expect(context.onSnapshot.mock.calls[0][0].localProxy.running).toBe(true);
    expect(context.onSettled).toHaveBeenCalledOnce();
    expect(setterFinished).toBe(true);
  });

  it("does not lose another change arriving during the trailing read", async () => {
    const context = createController();
    const first = deferred<LocalProxyStatus>();
    const second = deferred<LocalProxyStatus>();
    context.loadLocalProxyStatus.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
      .mockResolvedValueOnce(proxy(true));
    const refresh = context.controller.refresh();
    context.controller.refresh();
    first.resolve(proxy(false));
    await vi.waitFor(() => expect(context.loadLocalProxyStatus).toHaveBeenCalledTimes(2));
    const nextChange = context.controller.refresh();
    second.resolve(proxy(false));
    await Promise.all([refresh, nextChange]);

    expect(context.loadLocalProxyStatus).toHaveBeenCalledTimes(3);
    expect(context.onSnapshot).toHaveBeenCalledOnce();
    expect(context.onSnapshot.mock.calls[0][0].localProxy.running).toBe(true);
  });

  it("waits for all endpoints after a partial failure before starting the next read", async () => {
    const context = createController();
    const failed = deferred<Provider[]>();
    const slow = deferred<LocalProxyStatus>();
    context.loadProviders.mockReturnValueOnce(failed.promise);
    context.loadLocalProxyStatus.mockReturnValueOnce(slow.promise);
    const refresh = context.controller.refresh();
    failed.reject(new Error("provider read failed"));
    await failed.promise.catch(() => undefined);
    const change = context.controller.refresh();
    expect(context.loadProviders).toHaveBeenCalledOnce();
    expect(context.loadLocalProxyStatus).toHaveBeenCalledOnce();

    slow.resolve(proxy(false));
    await Promise.all([refresh, change]);
    expect(context.loadProviders).toHaveBeenCalledTimes(2);
    expect(context.onError).not.toHaveBeenCalled();
    expect(context.onSnapshot).toHaveBeenCalledOnce();
  });

  it("reports the current failure once and allows a later refresh to recover", async () => {
    const context = createController();
    const failure = new Error("read failed");
    context.loadLocalProxyStatus.mockRejectedValueOnce(failure);
    await context.controller.refresh();
    expect(context.onError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(context.onSnapshot).not.toHaveBeenCalled();
    expect(context.onSettled).toHaveBeenCalledOnce();

    await context.controller.refresh();
    expect(context.onSnapshot).toHaveBeenCalledOnce();
  });

  it("preserves a saved setting when the older read completes and the trailing refresh fails", async () => {
    const context = createController();
    const beforeSetting = deferred<LocalProxyStatus>();
    context.loadLocalProxyStatus.mockReturnValueOnce(beforeSetting.promise);
    context.loadProviders.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("read failed"));
    const initial = context.controller.refresh();
    const saved = proxy(true);
    context.controller.acceptLocalProxyStatus(saved);
    const settingRefresh = context.controller.refresh();
    beforeSetting.resolve(proxy(false));
    await Promise.all([initial, settingRefresh]);

    expect(context.onLocalProxyStatus).toHaveBeenCalledExactlyOnceWith(saved);
    expect(context.onSnapshot).not.toHaveBeenCalled();
    expect(context.onError).toHaveBeenCalledOnce();
  });

  it("discards queued reads and callbacks after unmount", async () => {
    const context = createController();
    const pending = deferred<LocalProxyStatus>();
    context.loadLocalProxyStatus.mockReturnValueOnce(pending.promise);
    const refresh = context.controller.refresh();
    context.controller.refresh();
    context.controller.dispose();
    context.controller.acceptLocalProxyStatus(proxy(true));
    await context.controller.refresh();
    pending.reject(new Error("late error"));
    await refresh;

    expect(context.loadLocalProxyStatus).toHaveBeenCalledOnce();
    expect(context.onSnapshot).not.toHaveBeenCalled();
    expect(context.onError).not.toHaveBeenCalled();
    expect(context.onSettled).not.toHaveBeenCalled();
    expect(context.onLocalProxyStatus).not.toHaveBeenCalled();
  });

  it("handles StrictMode cleanup and reactivation without overlapping reads or publishing the old mount", async () => {
    const context = createController();
    const oldMount = deferred<LocalProxyStatus>();
    context.loadLocalProxyStatus.mockReturnValueOnce(oldMount.promise).mockResolvedValueOnce(proxy(true));
    const oldRefresh = context.controller.refresh();
    context.controller.dispose();
    context.controller.activate();
    const newRefresh = context.controller.refresh();
    expect(context.loadLocalProxyStatus).toHaveBeenCalledOnce();
    oldMount.resolve(proxy(false));
    await Promise.all([oldRefresh, newRefresh]);

    expect(context.loadLocalProxyStatus).toHaveBeenCalledTimes(2);
    expect(context.onSnapshot).toHaveBeenCalledOnce();
    expect(context.onSnapshot.mock.calls[0][0].localProxy.running).toBe(true);
  });
});
