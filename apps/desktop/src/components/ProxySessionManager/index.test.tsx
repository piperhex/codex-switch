// @vitest-environment jsdom
import { act, useState } from "react";
import { ConfigProvider } from "antd";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadProxySessionRequests, loadProxySessions } from "../../api/backend";
import type { ProxySession } from "../../types";
import { ProxySessionManager } from "./index";
import { DashboardNavigation, type DashboardPage } from "../dashboard/DashboardNavigation";

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

function Fixture() {
  const [page, setPage] = useState<DashboardPage>("accounts");
  return <ConfigProvider theme={{ token: { motion: false } }}>
    <DashboardNavigation page={page} onPageChange={setPage} t={translate} />
    {page === "proxySessions" && <ProxySessionManager t={translate} />}
  </ConfigProvider>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
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

it("opens the session tab inline and allows navigation while a single poll remains pending", async () => {
  const load = vi.mocked(loadProxySessions).mockResolvedValue([session]);
  await act(async () => root.render(<Fixture />));
  expect(load).not.toHaveBeenCalled();
  await act(async () => button("nav.proxySessions").click());
  expect(button("nav.proxySessions").getAttribute("aria-current")).toBe("page");
  expect(container.querySelector("table")).not.toBeNull();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.querySelector(".ant-modal-mask")).toBeNull();
  expect(document.body.textContent).toContain("providers.proxy.sessionsConversationUnknown");

  load.mockResolvedValueOnce([{ ...session, title: "GUI 对话名称" }]);
  await act(async () => vi.advanceTimersByTime(2_000));
  expect(document.querySelector('strong[title="GUI 对话名称"]')).not.toBeNull();

  let completePoll: (sessions: ProxySession[]) => void = () => {};
  load.mockImplementationOnce(() => new Promise((resolve) => { completePoll = resolve; }));
  await act(async () => vi.advanceTimersByTime(2_000));
  await act(async () => vi.advanceTimersByTime(6_000));
  expect(load).toHaveBeenCalledTimes(3);
  await act(async () => button("nav.accounts").click());
  expect(container.querySelector("table")).toBeNull();
  await act(async () => completePoll([{ ...session, title: "GUI 对话名称" }]));
  await act(async () => vi.advanceTimersByTime(4_000));
  expect(load).toHaveBeenCalledTimes(3);
  load.mockResolvedValueOnce([{ ...session, title: "新对话名称" }]);
  await act(async () => button("nav.proxySessions").click());
  expect(load).toHaveBeenCalledTimes(4);
  expect(document.querySelector('strong[title="新对话名称"]')).not.toBeNull();
});

it("stops request detail polling when leaving the session page", async () => {
  vi.mocked(loadProxySessions).mockResolvedValue([session]);
  const loadDetails = vi.mocked(loadProxySessionRequests).mockResolvedValue([]);
  await act(async () => root.render(<Fixture />));
  await act(async () => button("nav.proxySessions").click());
  await act(async () => button("providers.proxy.sessionsRequestDetails").click());
  expect(loadDetails).toHaveBeenCalledExactlyOnceWith(session.id);
  let completePoll: (requests: []) => void = () => {};
  loadDetails.mockImplementationOnce(() => new Promise((resolve) => { completePoll = resolve; }));
  await act(async () => vi.advanceTimersByTime(2_000));
  await act(async () => vi.advanceTimersByTime(6_000));
  expect(loadDetails).toHaveBeenCalledTimes(2);
  await act(async () => button("nav.accounts").click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => completePoll([]));
  await act(async () => vi.advanceTimersByTime(4_000));
  expect(loadDetails).toHaveBeenCalledTimes(2);
});
