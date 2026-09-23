import { expect, test } from "@playwright/test";
import bundled from "../src/data/tokenCostPresets.json" with { type: "json" };

const harness = "/e2e/token-pricing-harness.html";

test("per-model Fast multipliers stay editable during a pending preset request", async ({ page }) => {
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/token-cost-presets", async (route) => {
    await pending;
    await route.fulfill({ json: { ...bundled, models: [...bundled.models, {
      ...bundled.models[0], model: "admin-added-model", aliases: [], fastModeMultiplier: 3,
    }] } });
  });
  await page.goto(harness);
  expect(await page.getByRole("columnheader").allTextContents()).toContain("快速模式成本倍率");
  const sol = page.getByRole("spinbutton", { name: "gpt-6-sol 快速模式倍率", exact: true });
  const luna = page.getByRole("spinbutton", { name: "gpt-6-luna 快速模式倍率", exact: true });
  await expect(page.getByLabel("预估费用")).toHaveText("0.60");
  await sol.fill("3");
  await sol.blur();
  await expect(page.getByLabel("预估费用")).toHaveText("0.90");
  await expect(luna).toHaveValue("");
  release?.();
  await expect(page.getByRole("spinbutton", { name: "admin-added-model 快速模式倍率", exact: true })).toBeVisible();
  await expect(sol).toHaveValue("3.00");
  await sol.fill("");
  await sol.blur();
  await expect(page.getByLabel("预估费用")).toHaveText("0.60");
  await page.screenshot({ path: "../../.codex-tmp/pricing-desktop.png", fullPage: true });
});

test("admin can add a priced model with a custom multiplier in the final column", async ({ page }) => {
  let saved: typeof bundled | undefined;
  await page.route("**/admin/api/token-cost-presets", async (route) => {
    if (route.request().method() === "PATCH") saved = route.request().postDataJSON() as typeof bundled;
    await route.fulfill({ json: saved ?? bundled });
  });
  await page.goto(harness + "?admin");
  await expect(page.getByRole("button", { name: "添加模型" })).toBeEnabled();
  await expect(page.getByRole("columnheader").last()).toHaveText("快速模式倍率");
  await page.getByRole("button", { name: "添加模型" }).click();
  const row = page.locator("tbody tr").last();
  await row.getByRole("textbox", { name: "模型名称", exact: true }).fill("new-priced-model");
  await row.getByRole("spinbutton", { name: "new-priced-model input", exact: true }).fill("1.2");
  await row.getByRole("spinbutton", { name: "new-priced-model fastModeMultiplier", exact: true }).fill("3.2");
  await page.getByRole("button", { name: "保存预设" }).click();
  await expect(page.getByText("已保存，用户下次启动 PC 端时生效。")).toBeVisible();
  expect(saved?.models.at(-1)).toMatchObject({ model: "new-priced-model", input: 1.2, fastModeMultiplier: 3.2 });
  await page.screenshot({ path: "../../.codex-tmp/pricing-admin.png", fullPage: true });
});