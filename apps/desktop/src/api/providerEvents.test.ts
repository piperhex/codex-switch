import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const events = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: events.listen, emit: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function stubRuntime(runtime: "hosted" | "desktop") {
  const localStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
  vi.stubGlobal("window", Object.assign(new EventTarget(), {
    ...(runtime === "desktop" ? { __TAURI_INTERNALS__: {} } : {}),
    localStorage, location: { hostname: "localhost" }, setInterval, clearInterval,
  }));
  vi.stubGlobal("document", {
    querySelector: () => runtime === "hosted" ? { getAttribute: () => "hosted" } : null,
  });
}

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); events.listen.mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Provider event subscriptions", () => {
  it("awaits hosted refresh promises and stops polling on unsubscribe", async () => {
    stubRuntime("hosted");
    const { subscribeToProviderEvents } = await import("./backend");
    const pending = deferred<void>();
    const refresh = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
    const unsubscribe = subscribeToProviderEvents(refresh);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(refresh).toHaveBeenCalledOnce();

    pending.resolve();
    await vi.advanceTimersByTimeAsync(2_500);
    expect(refresh).toHaveBeenCalledTimes(2);
    unsubscribe();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("ignores desktop events after cleanup while asynchronous unlisten is still pending", async () => {
    stubRuntime("desktop");
    const registered = deferred<() => void>();
    events.listen.mockReturnValue(registered.promise);
    const { subscribeToProviderEvents } = await import("./backend");
    const refresh = vi.fn().mockResolvedValue(undefined);
    const unsubscribe = subscribeToProviderEvents(refresh);
    const onChange = events.listen.mock.calls[0][1] as () => void | Promise<void>;
    await onChange();
    expect(refresh).toHaveBeenCalledOnce();
    unsubscribe();
    await onChange();
    expect(refresh).toHaveBeenCalledOnce();

    const unlisten = vi.fn();
    registered.resolve(unlisten);
    await registered.promise;
    expect(unlisten).toHaveBeenCalledOnce();
  });
});
