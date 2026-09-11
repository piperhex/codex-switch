import { expect, test } from "@playwright/test";

for (const width of [390, 1280]) {
  test(`proxy details remain with their reply and responsive at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/e2e/request-error-harness.html");
    const first = page.locator('[data-turn-id="first"]');
    const notice = first.locator("details");
    await expect(notice).toContainText("Codex 正在重试");
    await expect(notice.locator("pre")).toHaveCount(0);
    await notice.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(notice.locator("pre")).toContainText("upstream timed out");
    expect((await notice.boundingBox())!.width).toBeLessThanOrEqual(400);
    expect(await notice.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const refreshes = Number(await page.getByLabel("刷新次数").textContent());
    await page.getByLabel("消息", { exact: true }).fill("继续检查");
    await expect.poll(async () => Number(await page.getByLabel("刷新次数").textContent())).toBeGreaterThan(refreshes);
    await expect(page.getByLabel("消息", { exact: true })).toHaveValue("继续检查");
    await page.getByRole("button", { name: "继续对话" }).click();
    await expect(notice).toContainText("现已恢复");
    await expect(notice.locator("pre")).toBeVisible();
    await expect(page.locator('[data-turn-id="second"] details')).toHaveCount(0);
    await notice.locator("summary").click();
    await expect(notice.locator("pre")).toHaveCount(0);
  });
}
