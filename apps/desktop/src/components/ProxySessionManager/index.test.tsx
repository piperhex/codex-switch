// @vitest-environment jsdom
import { act } from "react";
import { ConfigProvider } from "antd";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadProxySessions } from "../../api/backend";
import type { ProxySession } from "../../types";
import { ProxySessionManager } from "./index";

vi.mock("../../api/backend", () => ({
  loadProxySessions: vi.fn(),
  loadProxySessionUnlimitedConversation: vi.fn().mockResolvedValue(false),
  loadProxySessionRequests: vi.fn().mockResolvedValue([]),
  setProxySessionUnlimitedConversation: vi.fn(),
}));

const session: ProxySession = {
  id: "gui-thread", client: "codex_switch_gui", connectedAt: 1, lastSeenAt: 1,
  activeRequests: 1, requestCount: 1, totalTokens: 0, inputTokens: 0,
  outputTokens: 0, reasoningTokens: 0, cachedTokens: 0,
};
let root: Root;
let container: HTMLDivElement;
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")]
  .find((entry) => entry.textContent === label)!;
const translate = (key: string) => key;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addListener() {}, removeListener() {} })));
  const getComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => getComputedStyle(element));
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("updates an active GUI session title and stays responsive during a slow poll", async () => {
  const load = vi.mocked(loadProxySessions).mockResolvedValueOnce([session]);
  await act(async () => root.render(<ConfigProvider theme={{ token: { motion: false } }}>
    <ProxySessionManager t={translate} />
  </ConfigProvider>));
  await act(async () => button("providers.proxy.sessions").click());
  expect(document.body.textContent).toContain("providers.proxy.sessionsConversationUnknown");

  load.mockResolvedValueOnce([{ ...session, title: "GUI 对话名称" }]);
  await act(async () => vi.advanceTimersByTime(2_000));
  expect(document.querySelector('strong[title="GUI 对话名称"]')).not.toBeNull();

  let completePoll: (sessions: ProxySession[]) => void = () => {};
  load.mockImplementationOnce(() => new Promise((resolve) => { completePoll = resolve; }));
  await act(async () => vi.advanceTimersByTime(2_000));
  await act(async () => vi.advanceTimersByTime(6_000));
  expect(load).toHaveBeenCalledTimes(3);
  await act(async () => button("providers.proxy.sessionsClose").click());
  expect(document.querySelector<HTMLElement>(".ant-modal-wrap")?.style.display).toBe("none");
  await act(async () => completePoll([{ ...session, title: "GUI 对话名称" }]));
  await act(async () => vi.advanceTimersByTime(4_000));
  expect(load).toHaveBeenCalledTimes(3);
});
