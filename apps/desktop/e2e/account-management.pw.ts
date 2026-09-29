import { expect, test, type Page } from "@playwright/test";

async function prepareAccounts(page: Page, options: { mode: "table" | "cards"; navigation: "top" | "sidebar" }) {
  await page.addInitScript(({ mode, navigation }) => {
    localStorage.setItem("codex-switch:language", "zh");
    localStorage.setItem("codex-switch:account-display-mode", mode);
    localStorage.setItem("codex-switch:navigation-style", navigation);
    localStorage.setItem("codex-switch:local-proxy-port", "8080");
    localStorage.setItem("codex-switch:local-proxy-running", "true");
    localStorage.setItem("codex-switch:providers", JSON.stringify([{
      id: "test-provider", name: "示例中转", kind: "custom", group: "group1",
      baseUrl: "https://example.com/v1", model: "example-model", models: ["example-model"],
      apiFormat: "openaiResponses", active: false, autoSwitchEnabled: true, hasApiKey: true,
    }]));
  }, options);
  await page.goto("/");
  await page.getByRole("button", { name: "账户管理", exact: true }).click();
  await expect(page.getByRole("tab", { name: "官方账户", exact: true })).toBeVisible();
}

for (const mode of ["table", "cards"] as const) {
  for (const navigation of ["sidebar", "top"] as const) {
    test(`${navigation} navigation switches ${mode} and actions together`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width: 1440, height: 900 });
      await prepareAccounts(page, { mode, navigation });
      const official = page.getByRole("tabpanel", { name: "官方账户", exact: true });
      const providers = page.getByRole("tabpanel", { name: "三方模型及中转", exact: true });
      const providerTab = page.getByRole("tab", { name: "三方模型及中转", exact: true });
      const nav = page.locator(`.${navigation}-tabs`);
      await expect(nav.getByRole("button", { name: "三方模型及中转", exact: true })).toHaveCount(0);
      await expect(official).toBeVisible();
      await expect(official.locator(mode === "table" ? "table" : ".account-card").first()).toBeVisible();
      await expect(page.getByRole("button", { name: "添加/更新账户", exact: true })).toBeVisible();
      await page.screenshot({ path: `../../.codex-tmp/account-management-official-${navigation}-${mode}.png` });
      await providerTab.click();
      await expect(providerTab).toHaveAttribute("aria-selected", "true");
      await expect(official).toBeHidden();
      await expect(providers).toBeVisible();
      await expect(providers.locator(mode === "table" ? "table" : ".provider-card").first()).toBeVisible();
      await expect(providers.getByText("示例中转", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "聚合 API 管理", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "添加/更新账户", exact: true })).toHaveCount(0);
      await expect(nav.getByRole("button", { name: "账户管理", exact: true })).toHaveAttribute("aria-current", "page");
      await page.screenshot({ path: `../../.codex-tmp/account-management-${navigation}-${mode}.png` });
      await page.setViewportSize({ width: 900, height: 800 });
      await expect(page.getByRole("button", { name: "分组管理", exact: true })).toBeInViewport();
      await expect(page.getByRole("button", { name: "ChatGPT", exact: true })).toBeInViewport();
      await expect(providers.locator(mode === "table" ? "table" : ".provider-card").first()).toBeInViewport();
      await page.screenshot({ path: `../../.codex-tmp/account-management-narrow-${navigation}-${mode}.png` });
      await providerTab.press("ArrowLeft");
      await expect(page.getByRole("tab", { name: "官方账户", exact: true })).toBeFocused();
      await expect(official).toBeVisible();
      await expect(providers).toBeHidden();
      await expect(page.getByRole("button", { name: "添加/更新账户", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "聚合 API 管理", exact: true })).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }
}

for (const navigation of ["sidebar", "top"] as const) {
  test(`${navigation} app integration keeps the two switches above its app list`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });
    await prepareAccounts(page, { mode: "table", navigation });
    const appTab = page.getByRole("tab", { name: "三方 App 接入", exact: true });
    const panel = page.getByRole("tabpanel", { name: "三方 App 接入", exact: true });
    await appTab.click();
    await expect(appTab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(`.${navigation}-tabs`).getByRole("button", { name: "三方 App 接入" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "账户管理", exact: true })).toHaveAttribute("aria-current", "page");
    const toolbar = page.locator("main > header");
    await expect(toolbar.getByRole("switch")).toHaveCount(2);
    const master = toolbar.getByRole("switch", { name: "写入三方 App", exact: true });
    const codex = toolbar.getByRole("switch", { name: "同时写入 Codex", exact: true });
    await expect(master).not.toBeChecked();
    await master.click();
    await expect(master).toBeChecked();
    await codex.click();
    await expect(codex).not.toBeChecked();
    await expect(panel.getByRole("listitem")).toHaveCount(8);
    await expect(panel.getByRole("switch", { name: "向 Claude Code 写入配置" })).toBeEnabled();
    await expect(toolbar.getByRole("button", { name: "ChatGPT", exact: true })).toHaveCount(0);
    await page.screenshot({ path: `../../.codex-tmp/account-management-apps-${navigation}.png` });
    await page.setViewportSize({ width: 900, height: 800 });
    await expect(master).toBeInViewport();
    await expect(codex).toBeInViewport();
    await expect(panel.getByRole("listitem").first()).toBeInViewport();
    await expect(panel.locator(".third-party-app-identity").first()).toHaveCSS("white-space", "nowrap");
    await page.screenshot({ path: `../../.codex-tmp/account-management-apps-narrow-${navigation}.png` });
    await appTab.press("Home");
    await expect(panel).toBeHidden();
    await expect(page.getByRole("tab", { name: "官方账户", exact: true })).toBeFocused();
    await appTab.click();
    await expect(master).toBeChecked();
    await expect(codex).not.toBeChecked();
    await page.getByRole("button", { name: "切换到暗黑主题", exact: true }).click();
    await page.screenshot({ path: `../../.codex-tmp/account-management-apps-dark-${navigation}.png` });
    expect(errors).toEqual([]);
  });
}
