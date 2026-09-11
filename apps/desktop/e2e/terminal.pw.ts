import { expect, test, type Page } from "@playwright/test";

interface Snapshot { opens: number; closes: number; writes: string[]; sizes: { cols: number; rows: number }[]; ticks: number }
declare global {
  interface Window { terminalHarness: { snapshot: () => Snapshot; stream: () => void } }
}
const snapshot = (page: Page) => page.evaluate(() => window.terminalHarness.snapshot());

test("embedded terminal themes, tab lifecycle, resize, input and concurrent chat controls", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/e2e/terminal-harness.html");
  await page.getByRole("button", { name: "切换终端" }).click();
  const panel = page.getByRole("region", { name: "终端", exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.locator(".xterm-screen")).toBeVisible();
  await expect.poll(async () => (await snapshot(page)).opens).toBe(1);
  await expect(panel).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(panel.locator(".xterm-viewport")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.screenshot({ path: testInfo.outputPath("terminal-light.png") });
  await panel.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("echo hello"); await page.keyboard.press("Enter");
  await expect.poll(async () => (await snapshot(page)).writes.join("")).toContain("echo hello\r");
  await page.getByRole("button", { name: "切换主题" }).click();
  await expect(panel).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await expect(panel.locator(".xterm-viewport")).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await page.screenshot({ path: testInfo.outputPath("terminal-dark.png") });
  await page.getByRole("button", { name: "收起终端", exact: true }).click();
  await expect(panel).toBeHidden();
  await page.getByRole("button", { name: "切换终端" }).click();
  expect((await snapshot(page)).opens).toBe(1);
  await page.getByRole("button", { name: "新建终端" }).click();
  await expect(panel.getByRole("tab")).toHaveCount(2);
  await expect.poll(async () => (await snapshot(page)).opens).toBe(2);
  await page.getByRole("button", { name: "关闭终端 2" }).click();
  await expect.poll(async () => (await snapshot(page)).closes).toBe(1);
  const grip = page.getByRole("separator", { name: "调整终端高度" });
  const before = await panel.boundingBox();
  await grip.focus(); await page.keyboard.press("ArrowUp");
  await expect.poll(async () => (await panel.boundingBox())!.height).toBeGreaterThan(before!.height);
  const ticks = (await snapshot(page)).ticks;
  await page.evaluate(() => window.terminalHarness.stream());
  await page.getByRole("textbox", { name: "聊天输入" }).fill("终端运行时仍能输入");
  await page.getByRole("button", { name: "查看文件更改" }).click();
  await expect(page.getByText("暂无文件更改")).toBeVisible();
  await page.getByRole("button", { name: "收起文件更改" }).click();
  await expect(page.getByRole("textbox", { name: "聊天输入" })).toHaveValue("终端运行时仍能输入");
  expect((await snapshot(page)).ticks).toBeGreaterThan(ticks);
  await page.setViewportSize({ width: 640, height: 600 });
  await expect(panel).toBeVisible();
  await expect.poll(async () => (await snapshot(page)).sizes.length).toBeGreaterThan(0);
});
