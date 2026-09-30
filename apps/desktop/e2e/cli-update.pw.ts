import { test, expect } from "@playwright/test";

test("silent downloads preserve input and connections, and every entry checks for newer updates", async ({ page }) => {
  let checks = 0;
  let installs = 0;
  let eventPolls = 0;
  let version = "0.100.0";
  let releaseDownload!: () => void;
  const download = new Promise<void>(resolve => { releaseDownload = resolve; });
  await page.route("**/__codex_switch__/api/invoke", async route => {
    const { command } = route.request().postDataJSON() as { command: string };
    let result: unknown = {};
    if (command === "codex_gui_cli_status") result = { version: "0.99.0" };
    if (command === "codex_gui_cli_check") { checks++; result = { version, size: 100, ready: false }; }
    if (command === "codex_gui_cli_prepare") {
      await download;
      result = { version, size: 100, ready: true };
    }
    if (command === "codex_gui_cli_install") { installs++; result = { version }; }
    if (command === "codex_gui_events") {
      eventPolls++;
      result = { cursor: { streamId: "updates", sequence: 1 }, reset: false, events: [] };
    }
    await route.fulfill({ json: { ok: true, result } });
  });
  try {
    await page.goto("/e2e/cli-update-harness.html");
    await expect(page.getByLabel("连接次数")).toHaveText("1");
    await expect.poll(() => checks).toBe(1);
    const beats = Number(await page.getByLabel("页面刷新").textContent());
    await page.getByLabel("聊天输入").fill("下载时继续输入");
    await page.getByRole("button", { name: "CLI 更新", exact: true }).click();
    await expect(page.getByRole("button", { name: "更新到 0.100.0" })).toBeVisible();
    await expect(page.getByText("正在下载 Codex…")).toHaveCount(0);
    await expect.poll(async () => Number(await page.getByLabel("页面刷新").textContent())).toBeGreaterThan(beats);
    await expect.poll(() => eventPolls).toBeGreaterThan(1);
    await page.getByRole("button", { name: "CLI 更新", exact: true }).click();
    await page.getByRole("button", { name: "离开 GUI", exact: true }).click();
    version = "0.101.0";
    await page.getByRole("button", { name: "进入 GUI", exact: true }).click();
    await expect.poll(() => checks).toBe(2);
    expect(installs).toBe(0);
    releaseDownload();
    await page.getByRole("button", { name: "CLI 更新", exact: true }).click();
    await expect(page.getByText("更新已下载，无进行中的对话时会自动安装；若暂未安装，将在后续检查或重启应用时重试。")).toBeVisible();
    expect((await page.locator(".ant-popover-inner").boundingBox())!.width).toBeLessThanOrEqual(400);
    await expect(page.getByLabel("当前版本")).toHaveText("0.99.0");
    await expect(page.getByLabel("聊天输入")).toHaveValue("下载时继续输入");
    await page.getByRole("button", { name: "更新到 0.101.0" }).click();
    await expect(page.getByLabel("当前版本")).toHaveText("0.101.0");
    await expect(page.getByLabel("连接次数")).toHaveText("2");
    expect(installs).toBe(1);
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally { releaseDownload(); }
});

test("download completion can activate immediately while preserving the draft", async ({ page }) => {
  const events: { name: string; payload: unknown }[] = [];
  let sequence = 0;
  let finishDownload!: () => void;
  const download = new Promise<void>(resolve => { finishDownload = resolve; });
  await page.route("**/__codex_switch__/api/invoke", async route => {
    const { command } = route.request().postDataJSON() as { command: string };
    let result: unknown = {};
    if (command === "codex_gui_cli_status") result = { version: "0.99.0" };
    if (command === "codex_gui_cli_check") result = { version: "0.100.0", size: 100, ready: false };
    if (command === "codex_gui_cli_prepare") {
      await download;
      result = { version: "0.100.0", size: 100, ready: true };
      events.push({ name: "codex-gui-cli-state", payload: { version: "0.100.0", release: result } });
    }
    if (command === "codex_gui_events") {
      result = { cursor: { streamId: "updates", sequence: ++sequence }, reset: false, events: events.splice(0) };
    }
    await route.fulfill({ json: { ok: true, result } });
  });
  await page.goto("/e2e/cli-update-harness.html");
  await expect(page.getByLabel("当前版本")).toHaveText("0.99.0");
  await page.getByLabel("聊天输入").fill("保留这条未发送的消息");
  finishDownload();
  await expect(page.getByLabel("当前版本")).toHaveText("0.100.0");
  await expect(page.getByLabel("聊天输入")).toHaveValue("保留这条未发送的消息");
  await expect(page.getByLabel("连接次数")).toHaveText("1");
  await expect(page.getByRole("alert")).toHaveCount(0);
});
