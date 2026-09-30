import { expect, test } from "@playwright/test";

test("bold local URLs open as websites with exact addresses", async ({ page }, info) => {
  const urls = ["http://localhost:3002", "http://127.0.0.1:8082"];
  for (const url of urls) await page.route(`${url}/`, route => route.fulfill({
    contentType: "text/html; charset=utf-8", body: `<h1>已打开 ${url}</h1>`,
  }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/e2e/file-preview-harness.html?kind=links");
  const links = page.locator("strong a");
  await expect(links).toHaveCount(2);
  for (const [index, url] of urls.entries()) {
    await expect(links.nth(index)).toHaveText(url);
    await expect(links.nth(index)).toHaveAttribute("href", url);
    await expect(links.nth(index)).toHaveCSS("font-weight", "700");
    await links.nth(index).click();
    const preview = page.getByRole("region", { name: "网页预览" });
    await expect(preview).toBeVisible();
    await expect(preview).toContainText(url);
    await expect(page.frameLocator('iframe[title="网页预览"]').getByRole("heading"))
      .toHaveText(`已打开 ${url}`);
    await expect(page.locator("body")).not.toHaveAttribute("data-opened");
    await expect(page.locator("body")).not.toHaveAttribute("data-action");
  }
  await page.screenshot({ path: info.outputPath("bold-local-links.png"), animations: "disabled" });
});
