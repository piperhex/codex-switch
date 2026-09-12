import { test, expect, type Page } from "@playwright/test";

const thread = { id: "conversation", cwd: "", name: "保留的对话", preview: "对话内容", updatedAt: 1, turns: [] };
const task = { id: "release", title: "跟踪 Codex Switch 发布", prompt: "检查新版本发布。", cwd: "",
  schedule: { kind: "interval", minutes: 5 }, status: "active", nextRunAt: Date.now() + 300_000,
  lastRunAt: null, lastThreadId: "conversation", lastTurnId: null, runStatus: "idle", error: null };
const skill = { id: "gui-plugin", title: "项目检查助手", description: "整理项目状态，汇总需要跟进的事项。",
  version: "1.0.0", archiveSize: 100, archiveSha256: "", hasPreview: false, official: true,
  installCount: 12, createdAt: "2026-09-12", updatedAt: "2026-09-12", installed: false, enabled: false };

async function mockCommands(page: Page) {
  const calls: { command: string; args: Record<string, unknown> }[] = [];
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.route("**/__codex_switch__/api/invoke", async (route) => {
    const body = route.request().postDataJSON() as { command: string; args?: Record<string, unknown> };
    const { command, args = {} } = body;
    calls.push({ command, args });
    let result: unknown = {};
    if (command === "codex_gui_cli_status") result = { version: "0.1.0" };
    if (command === "codex_gui_connect") result = [];
    if (command === "codex_gui_events") result = { cursor: { streamId: "test", sequence: 1 }, reset: false, events: [] };
    if (command === "codex_gui_model_settings") result = { threadId: null, selection: null, revision: 0 };
    if (command === "codex_gui_scheduled_tasks") result = [task];
    if (command === "list_market_skills") {
      await new Promise((resolve) => setTimeout(resolve, 400));
      result = [skill, { ...skill, id: "notes", title: "笔记整理助手" }, { ...skill, id: "review", title: "代码审查助手" }];
    }
    if (command === "list_official_plugins" || command === "list_prompt_plugins") result = [];
    if (command === "codex_gui_git") result = { cwd: "", branch: null, branches: [], changedFiles: 0, isWorktree: false };
    if (command === "codex_gui_usage_summary") result = { totalTokens: 0, estimatedCostUsd: 0,
      primaryRemainingPercent: null, primaryRemainingAggregated: false, providerEstimatedCost: null };
    if (command === "codex_gui_request") {
      const request = args.request as { operation: string };
      let data: unknown = { data: [], nextCursor: null };
      if (request.operation === "list") data = { data: [thread], nextCursor: null };
      if (request.operation === "read") data = { thread };
      if (request.operation === "goals") data = { goals: [] };
      if (request.operation === "plugins") data = { marketplaces: [], marketplaceLoadErrors: [] };
      result = { data };
    }
    await route.fulfill({ json: { ok: true, result } });
  });
  return calls;
}

async function openGui(page: Page, suffix = "") {
  await page.goto("/e2e/gui-features-harness.html" + suffix);
  const expand = page.getByRole("button", { name: "展开对话列表" });
  if (await expand.isVisible()) await expand.click();
}

test("feature navigation preserves drafts, filters tasks and scopes compact plugin cards to the GUI", async ({ page }) => {
  const calls = await mockCommands(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openGui(page);
  await page.getByRole("button", { name: "保留的对话", exact: true }).click();
  await page.getByRole("textbox", { name: "消息", exact: true }).fill("切换后继续编辑这条草稿");
  await page.getByRole("navigation", { name: "Codex GUI 导航" }).getByRole("button", { name: "定时任务" }).click();
  await expect(page.getByRole("heading", { name: "定时任务", exact: true })).toBeVisible();
  await expect(page.getByText(task.title, { exact: true })).toBeVisible();
  const search = page.getByPlaceholder("搜索已安排任务");
  await search.fill("没有这个任务");
  await expect(page.getByText(task.title, { exact: true })).toBeHidden();
  await search.clear();
  await page.screenshot({ path: "../../.codex-tmp/gui-scheduled-tasks-desktop.png", animations: "disabled" });
  await page.getByRole("navigation").getByRole("button", { name: "插件", exact: true }).click();
  const before = Number(await page.getByLabel("刷新次数").textContent());
  await expect.poll(async () => Number(await page.getByLabel("刷新次数").textContent())).toBeGreaterThan(before + 3);
  await expect(page.getByRole("heading", { name: skill.title, exact: true })).toBeVisible();
  await expect(page.getByText("Codex Home", { exact: true })).toHaveCount(0);
  const cards = page.locator(".skill-card");
  for (const card of await cards.all()) {
    const bounds = (await card.boundingBox())!;
    expect(bounds.width).toBeLessThan(350);
    expect(bounds.height).toBeLessThan(340);
  }
  await page.screenshot({ path: "../../.codex-tmp/gui-plugins-desktop.png", animations: "disabled" });
  await cards.first().getByRole("button", { name: "安装", exact: true }).click();
  await expect.poll(() => calls.filter((call) => call.command === "install_market_skill").length).toBe(1);
  expect(calls.filter((call) => ["list_market_skills", "install_market_skill"].includes(call.command))
    .every((call) => call.args.homeId === "codex-gui")).toBe(true);
  await page.getByRole("button", { name: "保留的对话", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toHaveText("切换后继续编辑这条草稿");
  await page.getByText("已归档", { exact: true }).click();
  await page.getByRole("navigation").getByRole("button", { name: "定时任务", exact: true }).click();
  await page.getByRole("button", { name: "管理任务：" + task.title }).click();
  await page.getByRole("menuitem", { name: "查看任务对话" }).click();
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toHaveAttribute("aria-disabled", "false");
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toHaveText("切换后继续编辑这条草稿");
  expect(errors).toEqual([]);
});

test("feature pages stay within a narrow dark viewport", async ({ page }) => {
  await mockCommands(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openGui(page, "?dark=1");
  await page.getByRole("navigation").getByRole("button", { name: "定时任务", exact: true }).click();
  await page.getByRole("button", { name: "收起对话列表" }).click();
  await expect(page.getByRole("heading", { name: "定时任务", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "../../.codex-tmp/gui-scheduled-tasks-dark-narrow.png", animations: "disabled" });
  await page.getByRole("button", { name: "展开对话列表" }).click();
  await page.getByRole("navigation").getByRole("button", { name: "插件", exact: true }).click();
  await page.getByRole("button", { name: "收起对话列表" }).click();
  await expect(page.getByRole("heading", { name: skill.title, exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "../../.codex-tmp/gui-plugins-dark-narrow.png", animations: "disabled" });
});
