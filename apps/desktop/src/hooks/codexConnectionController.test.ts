import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodexConnectResult, CodexConnectionStatus } from "../api/codexConnectionTypes";
import { CodexConnectionController } from "./codexConnectionController";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
}

async function createController() {
  let blocked = false;
  let visible = true;
  const loadStatus = vi.fn<() => Promise<CodexConnectionStatus>>()
    .mockResolvedValue({ state: "disconnected" });
  const connect = vi.fn<() => Promise<CodexConnectResult>>()
    .mockResolvedValue({ state: "disconnected", restartRequired: true });
  const restart = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const onError = vi.fn();
  const onOperationChange = vi.fn((operation) => {
    blocked = operation !== null;
    controller.availabilityChanged();
  });
  const controller = new CodexConnectionController({
    loadStatus, connect, restart, onError, onOperationChange,
    isBlocked: () => blocked,
    isVisible: () => visible,
  });
  controller.activate();
  await controller.refresh();
  return {
    controller, loadStatus, connect, restart, onError, onOperationChange,
    setBlocked: (next: boolean) => { blocked = next; controller.availabilityChanged(); },
    setVisible: (next: boolean) => { visible = next; controller.availabilityChanged(); },
  };
}

afterEach(() => { vi.useRealTimers(); });

describe("Codex connection actions", () => {
  it("safe connect only requests confirmation, and cancellation never calls the backend", async () => {
    const context = await createController();
    await context.controller.connect();
    expect(context.controller.getSnapshot().restartRequired).toBe(true);
    expect(context.restart).not.toHaveBeenCalled();
    const calls = context.connect.mock.calls.length;

    context.controller.cancelRestart();
    await context.controller.confirmRestart();

    expect(context.connect).toHaveBeenCalledTimes(calls);
    expect(context.restart).not.toHaveBeenCalled();
    expect(context.controller.getSnapshot().restartRequired).toBe(false);
  });

  it("rechecks on confirmation, restarts once, and uses the returned status", async () => {
    const context = await createController();
    await context.controller.connect();
    context.loadStatus.mockResolvedValue({ state: "connecting" });
    await context.controller.confirmRestart();

    expect(context.connect).toHaveBeenCalledTimes(2);
    expect(context.restart).toHaveBeenCalledOnce();
    expect(context.controller.getSnapshot()).toEqual({
      state: "connecting", operation: null, restartRequired: false,
    });
    expect(context.onOperationChange.mock.calls.map(([value]) => value))
      .toEqual(["start", null, "restart", null]);
  });

  it.each(["connected", "connecting", "unsupported"] as const)(
    "does not restart when confirmation recheck returns %s", async (state) => {
      const context = await createController();
      await context.controller.connect();
      context.connect.mockResolvedValue({ state, restartRequired: true });
      context.loadStatus.mockResolvedValue({ state });
      await context.controller.confirmRestart();
      expect(context.restart).not.toHaveBeenCalled();
      expect(context.controller.getSnapshot().state).toBe(state);
      expect(context.controller.getSnapshot().restartRequired).toBe(false);
    },
  );

  it("does not restart if recheck no longer requires it", async () => {
    const context = await createController();
    await context.controller.connect();
    context.connect.mockResolvedValue({ state: "disconnected", restartRequired: false });
    await context.controller.confirmRestart();
    expect(context.restart).not.toHaveBeenCalled();
  });

  it("deduplicates double clicks without being cancelled by its own parent busy flag", async () => {
    const context = await createController();
    const pending = deferred<CodexConnectResult>();
    context.connect.mockReturnValue(pending.promise);
    const first = context.controller.connect();
    await context.controller.connect();
    expect(context.connect).toHaveBeenCalledOnce();
    expect(context.controller.getSnapshot().operation).toBe("connect");

    pending.resolve({ state: "disconnected", restartRequired: true });
    await first;
    expect(context.controller.getSnapshot().restartRequired).toBe(true);
    const restartCheck = deferred<CodexConnectResult>();
    context.connect.mockReturnValue(restartCheck.promise);
    const confirmation = context.controller.confirmRestart();
    await context.controller.confirmRestart();
    restartCheck.resolve({ state: "disconnected", restartRequired: true });
    await confirmation;
    expect(context.restart).toHaveBeenCalledOnce();
    expect(context.onOperationChange).toHaveBeenLastCalledWith(null);
  });

  it("cancel during a slow confirmation recheck prevents the pending restart", async () => {
    const context = await createController();
    await context.controller.connect();
    const recheck = deferred<CodexConnectResult>();
    context.connect.mockReturnValue(recheck.promise);
    const confirmation = context.controller.confirmRestart();
    context.controller.cancelRestart();
    recheck.resolve({ state: "disconnected", restartRequired: true });
    await confirmation;
    expect(context.restart).not.toHaveBeenCalled();
    expect(context.controller.getSnapshot().operation).toBeNull();
  });

  it("reports failures once and never retries a failed restart", async () => {
    const context = await createController();
    await context.controller.connect();
    context.restart.mockRejectedValue(new Error("private backend details"));
    await context.controller.confirmRestart();
    await context.controller.confirmRestart();
    await context.controller.refresh();
    expect(context.restart).toHaveBeenCalledOnce();
    expect(context.onError).toHaveBeenCalledExactlyOnceWith("restart");
    expect(context.controller.getSnapshot().operation).toBeNull();
  });

  it("does not claim connection when the restart succeeds but status lookup fails", async () => {
    const context = await createController();
    await context.controller.connect();
    context.loadStatus.mockRejectedValue(new Error("status unavailable"));
    await context.controller.confirmRestart();
    expect(context.restart).toHaveBeenCalledOnce();
    expect(context.controller.getSnapshot().state).toBe("disconnected");
    expect(context.onError).toHaveBeenCalledExactlyOnceWith("restart");
  });

  it("reports a restart that completed without reconnecting", async () => {
    const context = await createController();
    await context.controller.connect();
    await context.controller.confirmRestart();
    expect(context.restart).toHaveBeenCalledOnce();
    expect(context.controller.getSnapshot().state).toBe("disconnected");
    expect(context.onError).toHaveBeenCalledExactlyOnceWith("restart");
  });

  it("unmount keeps pending work blocked, then releases busy once without publishing completion", async () => {
    const context = await createController();
    const pending = deferred<CodexConnectResult>();
    context.connect.mockReturnValue(pending.promise);
    const action = context.controller.connect();
    context.controller.dispose();
    expect(context.onOperationChange).toHaveBeenLastCalledWith("start");
    const listener = vi.fn();
    context.controller.subscribe(listener);
    pending.resolve({ state: "connected", restartRequired: false });
    await action;
    expect(listener).not.toHaveBeenCalled();
    expect(context.onOperationChange.mock.calls.map(([value]) => value)).toEqual(["start", null]);
    expect(context.controller.getSnapshot().state).toBe("disconnected");
  });

  it("unmount during confirmation recheck never starts a restart", async () => {
    const context = await createController();
    await context.controller.connect();
    const pending = deferred<CodexConnectResult>();
    context.connect.mockReturnValue(pending.promise);
    const action = context.controller.confirmRestart();
    context.controller.dispose();
    pending.resolve({ state: "disconnected", restartRequired: true });
    await action;
    expect(context.restart).not.toHaveBeenCalled();
    expect(context.onOperationChange).toHaveBeenLastCalledWith(null);
  });

  it("keeps parent busy until an already submitted restart settles after unmount", async () => {
    const context = await createController();
    await context.controller.connect();
    const restart = deferred<void>();
    context.restart.mockReturnValue(restart.promise);
    const action = context.controller.confirmRestart();
    await Promise.resolve();
    expect(context.restart).toHaveBeenCalledOnce();
    context.controller.dispose();
    expect(context.onOperationChange).toHaveBeenLastCalledWith("restart");
    const statusCalls = context.loadStatus.mock.calls.length;
    restart.resolve();
    await action;
    expect(context.onOperationChange).toHaveBeenLastCalledWith(null);
    expect(context.loadStatus).toHaveBeenCalledTimes(statusCalls);
  });

  it("external busy blocks actions, while a failed safe connection releases its own busy state", async () => {
    const context = await createController();
    context.setBlocked(true);
    await context.controller.connect();
    expect(context.connect).not.toHaveBeenCalled();
    context.setBlocked(false);
    context.connect.mockRejectedValue(new Error("private backend details"));
    await context.controller.connect();
    expect(context.restart).not.toHaveBeenCalled();
    expect(context.onError).toHaveBeenCalledExactlyOnceWith("connect");
    expect(context.controller.getSnapshot().operation).toBeNull();
    expect(context.onOperationChange).toHaveBeenLastCalledWith(null);
  });
});

describe("Codex background status", () => {
  it("waits for an older poll before connecting and ignores that poll's outdated state", async () => {
    const context = await createController();
    const oldPoll = deferred<CodexConnectionStatus>();
    context.loadStatus.mockReturnValueOnce(oldPoll.promise).mockResolvedValue({ state: "connected" });
    const polling = context.controller.refresh();
    context.connect.mockResolvedValue({ state: "connected", restartRequired: false });
    const action = context.controller.connect();
    expect(context.connect).not.toHaveBeenCalled();
    expect(context.controller.getSnapshot().operation).toBe("connect");
    expect(context.onOperationChange).toHaveBeenLastCalledWith("start");
    const states: string[] = [];
    context.controller.subscribe(() => { states.push(context.controller.getSnapshot().state); });
    oldPoll.resolve({ state: "unsupported" });
    await polling;
    await action;
    expect(context.connect).toHaveBeenCalledOnce();
    expect(states).not.toContain("unsupported");
    expect(context.controller.getSnapshot().state).toBe("connected");
  });

  it("waits for the status poll started after safe connect before confirming a restart", async () => {
    const context = await createController();
    const poll = deferred<CodexConnectionStatus>();
    context.loadStatus.mockReturnValueOnce(poll.promise).mockResolvedValue({ state: "connected" });
    await context.controller.connect();
    expect(context.controller.getSnapshot().restartRequired).toBe(true);
    const confirmation = context.controller.confirmRestart();
    await context.controller.confirmRestart();
    expect(context.connect).toHaveBeenCalledOnce();
    expect(context.restart).not.toHaveBeenCalled();
    expect(context.onOperationChange).toHaveBeenLastCalledWith("restart");
    poll.resolve({ state: "disconnected" });
    await confirmation;
    expect(context.connect).toHaveBeenCalledTimes(2);
    expect(context.restart).toHaveBeenCalledOnce();
    expect(context.controller.getSnapshot().state).toBe("connected");
  });

  it.each(["cancel", "unmount"] as const)(
    "%s during the confirmation poll wait prevents safe recheck and restart", async (cancellation) => {
      const context = await createController();
      const poll = deferred<CodexConnectionStatus>();
      context.loadStatus.mockReturnValueOnce(poll.promise);
      await context.controller.connect();
      const confirmation = context.controller.confirmRestart();
      if (cancellation === "cancel") context.controller.cancelRestart();
      else context.controller.dispose();
      poll.resolve({ state: "disconnected" });
      await confirmation;
      expect(context.connect).toHaveBeenCalledOnce();
      expect(context.restart).not.toHaveBeenCalled();
      expect(context.onOperationChange).toHaveBeenLastCalledWith(null);
    },
  );

  it("unmount during the initial poll wait prevents a queued safe connect", async () => {
    const context = await createController();
    const poll = deferred<CodexConnectionStatus>();
    context.loadStatus.mockReturnValueOnce(poll.promise);
    const polling = context.controller.refresh();
    const action = context.controller.connect();
    context.controller.dispose();
    poll.resolve({ state: "disconnected" });
    await Promise.all([polling, action]);
    expect(context.connect).not.toHaveBeenCalled();
    expect(context.restart).not.toHaveBeenCalled();
    expect(context.onOperationChange).toHaveBeenLastCalledWith(null);
  });

  it("allows only one poll while several intervals pass during a slow request", async () => {
    vi.useFakeTimers();
    const context = await createController();
    const pending = deferred<CodexConnectionStatus>();
    context.loadStatus.mockReturnValue(pending.promise);
    const timer = setInterval(() => void context.controller.refresh(), 5_000);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(context.loadStatus).toHaveBeenCalledTimes(2);
    pending.resolve({ state: "connected" });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(context.loadStatus).toHaveBeenCalledTimes(3);
    clearInterval(timer);
    context.controller.dispose();
  });

  it("skips hidden or blocked views and closes confirmation when connected", async () => {
    const context = await createController();
    await context.controller.connect();
    context.setVisible(false);
    const previousCalls = context.loadStatus.mock.calls.length;
    await context.controller.refresh();
    expect(context.loadStatus).toHaveBeenCalledTimes(previousCalls);
    context.setBlocked(true);
    context.setVisible(true);
    await context.controller.refresh();
    expect(context.loadStatus).toHaveBeenCalledTimes(previousCalls);
    context.loadStatus.mockResolvedValue({ state: "connected" });
    context.setBlocked(false);
    await Promise.resolve();
    expect(context.controller.getSnapshot().restartRequired).toBe(false);
  });

  it("a polling failure stays quiet and a later poll can recover", async () => {
    const context = await createController();
    context.loadStatus.mockResolvedValueOnce({ state: "connected" });
    await context.controller.refresh();
    context.loadStatus.mockRejectedValueOnce(new Error("private backend details"));
    await context.controller.refresh();
    expect(context.onError).not.toHaveBeenCalled();
    expect(context.controller.getSnapshot().state).toBe("disconnected");
    context.loadStatus.mockResolvedValue({ state: "connected" });
    await context.controller.refresh();
    expect(context.controller.getSnapshot().state).toBe("connected");
  });

  it("reactivation waits for the old poll, then fetches fresh state without publishing the old result", async () => {
    const context = await createController();
    const pending = deferred<CodexConnectionStatus>();
    context.loadStatus.mockReturnValueOnce(pending.promise).mockResolvedValue({ state: "connected" });
    const oldPoll = context.controller.refresh();
    context.controller.dispose();
    context.controller.activate();
    context.controller.availabilityChanged();
    expect(context.loadStatus).toHaveBeenCalledTimes(2);
    const states: string[] = [];
    context.controller.subscribe(() => { states.push(context.controller.getSnapshot().state); });
    pending.resolve({ state: "unsupported" });
    await oldPoll;
    await Promise.resolve();
    expect(context.loadStatus).toHaveBeenCalledTimes(3);
    expect(states).toEqual(["connected"]);
  });
});
