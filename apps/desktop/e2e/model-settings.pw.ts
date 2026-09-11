import { test, expect, type Page } from "@playwright/test";
import { modelSettingsBackend } from "./model-settings-backend";

const url = "/e2e/model-settings-harness.html";
const trigger = (page: Page) => page.getByRole("button", { name: /^模型与推理强度/ });

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
    await Promise.all([pc.goto(url), web.goto(url)]);
    await pc.getByRole("button", { name: "对话 a" }).click();
    await web.getByRole("button", { name: "对话 b" }).click();
    await choose(pc, "模型一", "xhigh"); await choose(web, "模型二", "low");
    await expect(trigger(pc)).toHaveText("模型一极高");
    await expect(trigger(web)).toHaveText("模型二低");
    await web.getByRole("button", { name: "对话 a" }).click();
    await expect(trigger(web)).toHaveText("模型一极高");
    await choose(web, "模型二", "low");
    await expect(trigger(pc)).toHaveText("模型二低");
    await web.reload();
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
