import { test, expect } from "@playwright/test";
import { MODEL_CATALOG_TIMEOUT_MS } from "../src/pages/codexGui/modelCatalogTimeout";
import { modelSettingsBackend } from "./model-settings-backend";

for (const width of [1280, 390]) {
  test(`retries stalled model loading while usage polling remains responsive at ${width}px`, async ({ page }) => {
    const backend = modelSettingsBackend();
    backend.pauseModels();
    await backend.attach(page.context());
    await page.setViewportSize({ width, height: 900 });
    try {
      await page.goto("/e2e/model-settings-harness.html", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("button", { name: "正在加载模型…", exact: true })).toBeDisabled();
      await expect.poll(backend.modelRequests).toBe(1);
      const beats = Number(await page.getByLabel("刷新次数").textContent());
      await page.getByRole("textbox", { name: "聊天消息" }).fill("加载完成后继续");
      await expect.poll(async () => Number(await page.getByLabel("刷新次数").textContent())).toBeGreaterThan(beats);
      const retry = page.getByRole("button", { name: "模型加载失败，点击重试", exact: true });
      await expect(retry).toBeEnabled({ timeout: MODEL_CATALOG_TIMEOUT_MS + 5_000 });
      await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeDisabled();
      await expect(page.getByText("正在刷新用量")).toBeVisible();
      await page.screenshot({ path: `../../.codex-tmp/model-retry-${width}.png`, animations: "disabled" });
      backend.releaseModels();
      await retry.click();
      await expect(page.getByRole("button", { name: /^模型与推理强度/ })).toContainText("模型一");
      await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeEnabled();
      await expect(page.getByRole("textbox", { name: "聊天消息" })).toHaveValue("加载完成后继续");
      expect(backend.sends).toHaveLength(0);
    } finally { backend.releaseModels(); backend.releaseUsage(); }
  });
}
