// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadCloudAuthState, loginCloud, syncCloudAccounts } from "../api/backend";
import { translate, type Translate } from "../i18n";
import type { CloudAuthState } from "../types";
import { useCloudAuth } from "./useCloudAuth";

vi.mock("../api/backend", () => ({
  loadCloudAuthState: vi.fn(), loginCloud: vi.fn(), syncCloudAccounts: vi.fn(),
}));

const initialState: CloudAuthState = {
  enabled: true, baseUrl: "https://example.test", authenticated: false,
  userEmail: null, userId: null, lastSyncAt: null, sessionExpired: false,
};
const invalidLogin = 'Cloud login failed with HTTP 401 Unauthorized: '
  + '{"error":"Unauthorized","message":"Invalid email or password","statusCode":401}';
const notify = vi.fn();
const t: Translate = (key, values) => translate("zh", key, values);
let auth: ReturnType<typeof useCloudAuth>;
let root: Root;
let container: HTMLDivElement;

function Fixture() {
  auth = useCloudAuth(notify, t);
  return null;
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(loadCloudAuthState).mockResolvedValue(initialState);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Fixture />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it.each([
  [invalidLogin, "邮箱或密码不正确，请重试。 如果还未注册，请点击注册。"],
  [new Error(invalidLogin), "邮箱或密码不正确，请重试。 如果还未注册，请点击注册。"],
  ["Cloud login failed with HTTP 401 Unauthorized", "邮箱或密码不正确，请重试。 如果还未注册，请点击注册。"],
  ["Cloud login failed with HTTP 429: Too many incorrect sign-in attempts. Please try again in 5 minutes.",
    "登录错误次数过多，请在 5 分钟后重试。"],
  ["Cloud login failed with HTTP 429: Too many requests", "登录尝试过于频繁，请稍后重试。"],
  ["Cloud login failed with HTTP 503: <html>Unavailable</html>", "登录失败，请稍后重试。 如果还未注册，请点击注册。"],
  ["Cloud account download failed with HTTP 401", "登录失败，请稍后重试。 如果还未注册，请点击注册。"],
])("shows a safe, localized login failure for %s", async (error, expected) => {
  vi.mocked(loginCloud).mockRejectedValue(error);
  await act(async () => expect(auth.login("review@example.test", "incorrect", false)).resolves.toBe(false));
  expect(notify).toHaveBeenCalledExactlyOnceWith(expected);
  expect(auth.loading).toBe(false);
  expect(auth.state).toEqual(initialState);
  expect(syncCloudAccounts).not.toHaveBeenCalled();
});

it("keeps the pending login asynchronous and allows retry after failure", async () => {
  let rejectLogin!: (error: string) => void;
  vi.mocked(loginCloud).mockReturnValue(new Promise((_, reject) => { rejectLogin = reject; }));
  let result!: Promise<boolean>;
  await act(async () => { result = auth.login("review@example.test", "incorrect", false); });
  expect(auth.loading).toBe(true);
  expect(notify).not.toHaveBeenCalled();
  await act(async () => rejectLogin(invalidLogin));
  expect(await result).toBe(false);
  expect(auth.loading).toBe(false);

  const signedIn = { ...initialState, authenticated: true, userEmail: "review@example.test" };
  vi.mocked(loginCloud).mockResolvedValue({
    state: signedIn, passwordSaved: false, credentialStorageUpdated: true,
  });
  vi.mocked(loadCloudAuthState).mockResolvedValue(signedIn);
  await act(async () => expect(auth.login("review@example.test", "correct", false)).resolves.toBe(true));
  expect(auth.state).toEqual(signedIn);
  expect(auth.loading).toBe(false);
  expect(syncCloudAccounts).toHaveBeenCalledOnce();
});
