import { test, expect, type Page } from "@playwright/test";
import { modelSettingsBackend } from "./model-settings-backend";

const url = "/e2e/model-settings-harness.html";
const trigger = (page: Page) => page.getByRole("button", { name: /^模型与推理强度/ });

test('cycles lightning speed across desktop clients while usage polling is pending', async ({ browser }) => {
  const backend = modelSettingsBackend();
  const pcContext = await browser.newContext(); const webContext = await browser.newContext();
  await backend.attach(pcContext); await backend.attach(webContext);
  const pc = await pcContext.newPage(); const web = await webContext.newPage();
  try {
    await Promise.all([pc.goto(url, { waitUntil: "domcontentloaded" }),
      web.goto(url, { waitUntil: "domcontentloaded" })]);
    await trigger(pc).click(); await trigger(web).click();
    const speed = pc.locator('.request-speed-button');
    for (const [mode, count] of [['fast', 1], ['ultrafast', 2], ['normal', 0]] as const) {
      await speed.click();
      await expect(speed).toHaveAttribute('data-speed', mode);
      await expect(speed.locator('.is-lit')).toHaveCount(count);
      await expect(web.locator('.request-speed-button')).toHaveAttribute('data-speed', mode);
      await pc.screenshot({ path: `../../.codex-tmp/gui-speed-${mode}.png`, animations: 'disabled' });
    }
    const beats = Number(await pc.getByLabel('刷新次数').textContent());
    await expect.poll(async () => Number(await pc.getByLabel('刷新次数').textContent())).toBeGreaterThan(beats);
  } finally { backend.releaseUsage(); await pcContext.close(); await webContext.close(); }
});

for (const width of [1280, 390]) {
  test(`discovers a new model while the picker and usage polling are open at ${width}px`, async ({ page }) => {
    const backend = modelSettingsBackend();
    await backend.attach(page.context());
    await page.setViewportSize({ width, height: 900 });
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await expect(trigger(page)).toContainText("模型一");
      backend.pauseModels();
      await trigger(page).click();
      await page.getByRole("button", { name: "选择模型", exact: true }).click();
      await expect(page.getByRole("menuitemradio", { name: "模型一" })).toBeEnabled();
      const beats = Number(await page.getByLabel("刷新次数").textContent());
      await expect.poll(async () => Number(await page.getByLabel("刷新次数").textContent())).toBeGreaterThan(beats);
      await expect(page.getByText("正在刷新用量")).toBeVisible();
      backend.addModel("gpt-6.1-sol");
      backend.releaseModels();
      await page.getByRole("menuitemradio", { name: "gpt-6.1-sol" }).click();
      await expect(trigger(page)).toContainText("gpt-6.1-sol");
      expect((await page.locator(".ant-popover-inner").boundingBox())!.width).toBeLessThanOrEqual(400);
      await page.screenshot({ path: `../../.codex-tmp/model-catalog-${width}.png`, animations: "disabled" });
    } finally { backend.releaseModels(); backend.releaseUsage(); }
  });
}

async function choose(page: Page, model: string, effort: "low" | "xhigh") {
  await trigger(page).click();
  await page.getByRole("button", { name: "选择模型", exact: true }).click();
  await page.getByRole("menuitemradio", { name: model }).click();
  const slider = page.getByRole("slider", { name: "推理强度" });
  await slider.focus(); await slider.press(effort === "low" ? "Home" : "End");
  await slider.press("Escape");
  await expect(page.getByRole("status", { name: "模型同步" })).toHaveText("模型设置已同步");
}

test("independent conversations synchronize across clients while usage polling is pending", async ({ browser }) => {
  const backend = modelSettingsBackend();
  const pcContext = await browser.newContext(); const webContext = await browser.newContext();
  await backend.attach(pcContext); await backend.attach(webContext);
  const pc = await pcContext.newPage(); const web = await webContext.newPage();
  try {
    await Promise.all([pc.goto(url, { waitUntil: "domcontentloaded" }),
      web.goto(url, { waitUntil: "domcontentloaded" })]);
    await pc.getByRole("button", { name: "对话 a" }).click();
    await web.getByRole("button", { name: "对话 b" }).click();
    await choose(pc, "模型一", "xhigh"); await choose(web, "模型二", "low");
    await expect(trigger(pc)).toHaveText("模型一极高");
    await expect(trigger(web)).toHaveText("模型二低");
    await web.getByRole("button", { name: "对话 a" }).click();
    await expect(trigger(web)).toHaveText("模型一极高");
    await choose(web, "模型二", "low");
    await expect(trigger(pc)).toHaveText("模型二低");
    await web.reload({ waitUntil: "domcontentloaded" });
    await expect(trigger(web)).toHaveText("模型二低");
    await web.getByRole("button", { name: "对话 b" }).click();
    await expect(trigger(web)).toHaveText("模型二低");
    const beats = Number(await pc.getByLabel("刷新次数").textContent());
    await pc.getByRole("textbox", { name: "聊天消息" }).fill("继续检查");
    await expect(pc.getByText("正在刷新用量")).toBeVisible();
    await expect.poll(async () => Number(await pc.getByLabel("刷新次数").textContent())).toBeGreaterThan(beats);
    await pc.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect.poll(() => backend.sends.length).toBe(1);
    expect(backend.sends[0]).toMatchObject({ threadId: "a", model: "second", effort: "low" });
    await trigger(pc).click();
    expect((await pc.locator(".ant-popover-inner").boundingBox())!.width).toBeLessThanOrEqual(400);
    await pc.screenshot({ path: "../../.codex-tmp/model-settings-pc.png", animations: "disabled" });
    backend.releaseUsage();
    await expect(pc.getByText("用量 123")).toBeVisible();
  } finally {
    backend.releaseUsage(); await pcContext.close(); await webContext.close();
  }
});


test("switches during generation with an inline marker while usage polling waits", async ({ page }) => {
  const backend = modelSettingsBackend("applied");
  await backend.attach(page.context());
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "对话 a" }).click();
    await expect(page.getByRole("status", { name: "模型同步" })).toHaveText("模型设置已同步");
    backend.startTurn("a");
    await expect(page.getByRole("button", { name: "停止生成", exact: true })).toBeVisible();
    await trigger(page).click();
    await page.getByRole("button", { name: "选择模型", exact: true }).click();
    const beats = Number(await page.getByLabel("刷新次数").textContent());
    await page.getByRole("menuitemradio", { name: "模型二" }).click();
    await page.getByRole("slider", { name: "推理强度" }).press("Escape");
    const notice = page.getByLabel("对话消息").locator("[data-model-change]");
    await expect(notice).toHaveText("模型已从 模型一 更改为 模型二");
    await notice.getByRole("button", { name: "模型切换说明" }).hover();
    const tooltip = page.getByRole("tooltip").filter({ hasText: "将从下一次请求起生效。" });
    await expect(tooltip).toContainText("下一次请求");
    await expect(tooltip).toContainText("可能使响应变慢");
    expect((await tooltip.boundingBox())!.width).toBeLessThanOrEqual(400);
    await expect(page.getByRole("button", { name: "停止生成", exact: true })).toBeVisible();
    await expect(page.getByText("正在刷新用量")).toBeVisible();
    await expect.poll(async () => Number(await page.getByLabel("刷新次数").textContent())).toBeGreaterThan(beats);
    expect(backend.sends).toHaveLength(0);
    await page.screenshot({ path: "../../.codex-tmp/live-model-switch.png", animations: "disabled" });
    await page.getByRole("button", { name: "对话 b" }).click();
    await expect(notice).toHaveCount(0);
    await page.getByRole("button", { name: "对话 a" }).click();
    await expect(notice).toHaveText("模型已从 模型一 更改为 模型二");
  } finally { backend.releaseUsage(); }
});
