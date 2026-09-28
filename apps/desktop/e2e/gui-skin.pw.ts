import { test, expect } from "@playwright/test";

for (const dark of [false, true]) {
  test(`independent GUI skin selection persists and keeps the shared skin unchanged (${dark ? "dark" : "light"})`,
    async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/e2e/gui-skin-harness.html${dark ? "?dark" : ""}`);
      await page.getByRole("tab", { name: "皮肤", exact: true }).click();
      const panel = page.getByRole("tabpanel", { name: "皮肤", exact: true });
      await expect(panel.getByText("先安装换肤组件")).toHaveCount(0);
      await page.getByPlaceholder("搜索皮肤").fill("preset-rose-reverie");
      const card = panel.locator("article").first();
      await card.getByRole("button").click();
      await expect(card.getByRole("button", { name: "已应用" })).toBeDisabled();
      const effect = page.getByLabel("皮肤效果");
      await expect(effect).toHaveAttribute("data-dream-skin", "true");
      await expect(panel.getByRole("radio", { name: "独立设置" })).toBeChecked();
      await page.screenshot({ path: `../../.codex-tmp/gui-skin-${dark ? "dark" : "light"}.png`,
        animations: "disabled" });
      const slider = panel.getByRole("slider");
      await slider.focus();
      await page.keyboard.press("ArrowLeft");
      await expect(effect).toHaveCSS("--gui-skin-overlay", "75%");
      await page.evaluate(() => (window as unknown as { guiSkinFixture: { pauseShared: () => void } })
        .guiSkinFixture.pauseShared());
      await expect(effect).toHaveAttribute("data-dream-skin", "true");
      const before = Number(await page.getByLabel("刷新次数").textContent());
      await expect.poll(async () => Number(await page.getByLabel("刷新次数").textContent())).toBeGreaterThan(before + 3);
      await page.reload();
      await expect(effect).toHaveAttribute("data-dream-skin", "true");
      await expect(effect).toHaveCSS("--gui-skin-overlay", "75%");
      await page.getByRole("tab", { name: "皮肤", exact: true }).click();
      await panel.getByText("不使用皮肤", { exact: true }).click();
      await expect(effect).not.toHaveAttribute("data-dream-skin");
      await panel.getByText("独立设置", { exact: true }).click();
      await expect(effect).toHaveAttribute("data-dream-skin", "true");
      await panel.getByText("已保存", { exact: true }).click();
      await panel.locator("article").getByRole("button").click();
      await expect(panel.locator("article").getByRole("button", { name: "已应用" })).toBeDisabled();
      await panel.getByText("社区皮肤", { exact: true }).click();
      await panel.locator("article").getByRole("button", { name: "安装并应用" }).click();
      await expect(panel.locator("article").getByRole("button", { name: "已应用" })).toBeDisabled();
      const calls = await page.evaluate(() => (window as unknown as { guiSkinFixture: { calls: string[] } })
        .guiSkinFixture.calls);
      expect(calls).toContain("install_dream_skin_market_theme");
      expect(calls).not.toContain("apply_dream_skin_theme");
      expect(calls).not.toContain("install_dream_skin");
      await page.setViewportSize({ width: 1024, height: 720 });
      expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await expect(page.getByRole("button", { name: /^完\s*成$/ })).toBeInViewport();
      expect(errors).toEqual([]);
    });
}
