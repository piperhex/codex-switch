import { expect, test } from "@playwright/test";

test("keeps interaction and session polling responsive during a long reply and slow account reads", async ({ page }) => {
  let releaseAccounts = () => {};
  const accountGate = new Promise<void>(resolve => { releaseAccounts = resolve; });
  let accountReads = 0, pendingAccounts = 0, maximumPendingAccounts = 0, sessionPolls = 0;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://fonts.googleapis.com/**", route => route.abort());
  await page.route("**/__codex_switch__/api/invoke", async route => {
    const { command } = route.request().postDataJSON() as { command: string };
    let result: unknown = {};
    if (command === "list_accounts") {
      accountReads++;
      maximumPendingAccounts = Math.max(maximumPendingAccounts, ++pendingAccounts);
      await accountGate;
      pendingAccounts--;
      result = [];
    }
    if (command === "get_app_info") result = { version: "test", codexHome: "C:/test/.codex" };
    if (command === "get_proxy_session_unlimited_conversation") result = false;
    if (command === "list_proxy_sessions") {
      sessionPolls++;
      result = [{ id: "active", client: "codex_switch_gui", connectedAt: 1, lastSeenAt: 1,
        activeRequests: 1, requestCount: sessionPolls, totalTokens: 0, inputTokens: 0,
        outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 }];
    }
    await route.fulfill({ json: { ok: true, result } });
  });
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/e2e/responsiveness-harness.html");
    await expect.poll(() => accountReads).toBe(1);
    await page.getByRole("button", { name: "Refresh burst" }).click();
    await page.getByRole("button", { name: "Start stream" }).click();
    await expect.poll(async () => Number(await page.getByLabel("Received characters").textContent()))
      .toBeGreaterThan(100_800);
    await page.getByLabel("Draft").fill("The draft remains editable while requests are running.");
    for (let index = 0; index < 5; index++) {
      await page.getByRole("button", { name: `Click ${index}`, exact: true }).click({ timeout: 2_000 });
    }
    await expect(page.getByRole("button", { name: "Click 5", exact: true })).toBeVisible();
    await expect.poll(() => sessionPolls).toBeGreaterThanOrEqual(3);
    expect(accountReads).toBe(1);
    await expect(page.getByLabel("Accounts loading")).toHaveText("true");
    const updates = Number(await page.locator("[data-reply]").getAttribute("data-updates"));
    expect(updates).toBeGreaterThan(0);
    expect(updates).toBeLessThan(12);
    await page.getByRole("button", { name: "Stop stream" }).click({ timeout: 2_000 });
    await expect(page.locator("[data-reply]")).toContainText("STREAM_COMPLETED");
    await expect(page.getByLabel("Draft")).toHaveValue("The draft remains editable while requests are running.");
    releaseAccounts();
    await expect(page.getByLabel("Accounts loading")).toHaveText("false");
    expect(accountReads).toBe(2);
    expect(maximumPendingAccounts).toBe(1);
    await page.screenshot({ path: "../../.codex-tmp/desktop-responsiveness.png" });
    await page.getByRole("button", { name: "Toggle sessions" }).click();
    await expect(page.locator("table")).toHaveCount(0);
    const pollsAfterUnmount = sessionPolls;
    await page.waitForTimeout(2_100);
    expect(sessionPolls).toBe(pollsAfterUnmount);
    expect(errors).toEqual([]);
    console.info({ accountReads, maximumPendingAccounts, sessionPolls, longReplyUpdates: updates });
  } finally {
    releaseAccounts();
  }
});
