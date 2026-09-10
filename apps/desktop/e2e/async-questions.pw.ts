import { test, expect } from "@playwright/test";
import type { Conversation } from "../src/pages/codexGui/types";

const title = "“等很久”是点切换后一直转圈，还是切换后发消息一直没有回复？";
const options = ["点切换后一直转圈", "切换后发消息等很久", "两种情况都有"];
const fixture: Conversation = { thread: { id: "async", cwd: "", preview: "", updatedAt: 1 },
  activeTurn: "turn", tokens: 0, error: "", turns: [{ id: "turn", status: "inProgress", items: [
    { id: "ask", type: "agentMessage", delivery: "async", phase: "final_answer", text: title,
      questions: [{ title, options }, { title: "还有哪些现象？", options: null }] },
  ] }] };

test("async questions show choices during work, preserve failed answers, and fit narrow windows", async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 900 });
  await page.route("**/history-fixture.json", (route) => route.fulfill({ json: fixture }));
  const replies: unknown[] = [];
  await page.route("**/async-answer", (route) => {
    replies.push(route.request().postDataJSON());
    return route.fulfill({ status: replies.length === 1 ? 500 : 200, body: "{}" });
  });
  await page.goto("/e2e/tool-history-harness.html");
  const card = page.getByRole("region", { name: "需要你的补充" });
  await expect(card).toBeVisible();
  await expect(card.getByRole("radio")).toHaveCount(3);
  await expect(card.getByRole("radio", { name: options[0], exact: true })).toBeChecked();
  expect(replies).toHaveLength(0);
  await expect(card.getByRole("button", { name: "提交回答" })).toBeDisabled();
  await card.getByRole("radio", { name: options[1], exact: true }).check();
  await card.getByRole("textbox", { name: "还有哪些现象？" }).fill("列表里也找不到这个账户");
  const submit = card.getByRole("button", { name: "提交回答" });
  await submit.click();
  await expect(submit).toBeEnabled();
  await expect(card.getByRole("textbox", { name: title, exact: true })).toHaveValue(options[1]);
  expect((await card.boundingBox())!.width).toBeLessThanOrEqual(400);
  await page.getByLabel("消息", { exact: true }).fill("任务执行时仍然能输入");
  await expect(page.getByLabel("消息", { exact: true })).toHaveValue("任务执行时仍然能输入");
  await page.screenshot({ path: "../../.codex-tmp/async-questions.png", animations: "disabled" });
  await card.getByRole("textbox", { name: title, exact: true }).fill("切换成功了，但回复慢");
  await submit.click();
  await expect(card).toHaveCount(0);
  expect(replies).toHaveLength(2);
  expect(replies[1]).toMatchObject({ answers: ["切换成功了，但回复慢", "列表里也找不到这个账户"] });
});
