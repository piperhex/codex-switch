import { expect, test } from "@playwright/test";

for (const width of [390, 1280]) {
  test(`conversation references can be selected, restored and sent at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/e2e/conversation-mentions-harness.html");
    const editor = page.getByRole("textbox", { name: "消息", exact: true });
    await editor.fill("@");
    const list = page.getByRole("listbox", { name: "对话", exact: true });
    await expect(list.getByRole("option")).toHaveCount(2);
    await expect(list.getByRole("option").first()).toContainText("运行中");
    expect((await list.locator("..").boundingBox())!.width).toBeLessThanOrEqual(400);
    await page.screenshot({ path: `../../.codex-tmp/conversation-awareness/menu-${width}.png` });
    await editor.press("ArrowDown"); await editor.press("Enter");
    const reference = page.getByText("@首页设计方案", { exact: true });
    await expect(reference).toBeVisible();
    await expect(page.locator("body")).not.toHaveAttribute("data-sent");
    await page.getByRole("button", { name: "切换对话" }).click();
    await expect(reference).toHaveCount(0);
    await page.getByRole("button", { name: "切换对话" }).click();
    await expect(reference).toBeVisible();
    await editor.fill("参考这个方案继续实现"); await editor.press("Enter");
    await expect(reference).toHaveCount(0);
    const sent = JSON.parse((await page.locator("body").getAttribute("data-sent"))!);
    expect(sent.text).toBe("参考这个方案继续实现");
    expect(sent.attachments).toEqual([{ kind: "conversation", name: "首页设计方案", path: "codex-thread://design" }]);
  });
}

test("slow conversation refresh stays single flight and keeps the editor responsive", async ({ page }) => {
  await page.goto("/e2e/conversation-mentions-harness.html?delay=5500");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await editor.fill("@");
  await expect(page.getByText("正在加载对话…", { exact: true })).toBeVisible();
  const before = Number(await page.getByLabel("刷新次数").textContent());
  await expect(page.getByRole("option")).toHaveCount(2, { timeout: 10_000 });
  expect(Number(await page.getByLabel("刷新次数").textContent())).toBeGreaterThan(before + 50);
  await expect(page.locator("body")).toHaveAttribute("data-max-pending", "1");
  await editor.press("Escape"); await editor.fill("仍可输入");
  await expect(editor).toHaveText("仍可输入");
});
