import { test, expect } from "@playwright/test";
import type { Conversation, Item } from "../src/pages/codexGui/types";

const screenshot = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQKsAAAAASUVORK5CYII=";
const output = "工具输出内容 ".repeat(150_000);
const items: Item[] = [
  { id: "question", type: "userMessage", content: [{ type: "text", text: "检查截图和日志" }] },
  { id: "capture", type: "mcpToolCall", tool: "capture", status: "completed", arguments: { window: "demo" },
    result: { content: [{ type: "image", mimeType: "image/png", data: screenshot }],
      structuredContent: { description: "窗口信息 ".repeat(30_000) } } },
  { id: "long", type: "mcpToolCall", tool: "read_log", status: "completed",
    result: { content: [{ type: "text", text: output }] } },
  { id: "answer", type: "agentMessage", phase: "final_answer", text: "检查完成。" },
];
const fixture: Conversation = { thread: { id: "heavy", cwd: "", preview: "", updatedAt: 1 },
  activeTurn: null, tokens: 0, error: "", turns: [{ id: "turn", status: "completed", items }] };

test("collapsed tool history does no heavy rendering and each opened output stays bounded", async ({ page }) => {
  await page.route("**/history-fixture.json", (route) => route.fulfill({ json: fixture }));
  await page.goto("/e2e/tool-history-harness.html");
  await expect(page.getByText("检查完成。", { exact: true })).toBeVisible();
  await expect(page.locator("img")).toHaveCount(0);
  await expect(page.locator("pre")).toHaveCount(0);
  const process = page.locator("summary[data-history-anchor]");
  await process.click();
  await expect(page.locator('[data-message-id="capture"]')).toBeVisible();
  await expect(page.locator("img")).toHaveCount(0);
  await page.locator('[data-message-id="capture"] > details > summary').click();
  await expect(page.getByAltText("工具返回的图片")).toHaveCount(1);
  await expect(page.locator("pre")).toHaveCount(0);
  await page.getByText("结构化结果", { exact: true }).click();
  expect((await page.locator("pre").textContent())!.length).toBeLessThanOrEqual(8_000);
  await page.locator('[data-message-id="long"] > details > summary').click();
  const log = page.locator('[data-message-id="long"]');
  await expect(log.getByLabel("内容页码")).toHaveText("1 / 132");
  expect((await log.textContent())!.length).toBeLessThan(8_200);
  await log.getByRole("button", { name: "下一段", exact: true }).click();
  await expect(log.getByLabel("内容页码")).toHaveText("2 / 132");
  await page.getByLabel("消息", { exact: true }).fill("展开日志后仍可输入");
  await expect(page.getByLabel("消息", { exact: true })).toHaveValue("展开日志后仍可输入");
  await page.screenshot({ path: "../../.codex-tmp/tool-output-pages.png", animations: "disabled" });
  await process.click();
  await expect(page.locator("img")).toHaveCount(0);
  await expect(page.locator("pre")).toHaveCount(0);
  await page.getByRole("button", { name: "离开对话" }).click();
  await page.getByRole("button", { name: "返回对话" }).click();
  await expect(page.getByText("检查完成。", { exact: true })).toBeVisible();
  await expect(page.locator("img")).toHaveCount(0);
});
