// Requires Vite on 1489 and the native test executable built with `cargo test --no-run`.
// Runs a separate WebView2 profile; never attaches to the user's running app or browser.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

assert.ok(process.argv[2], "Pass the codex_switch_lib_tests executable path");
const debugPort = Number(process.env.WEBSITE_PREVIEW_DEBUG_PORT ?? 1491);
assert.ok(Number.isInteger(debugPort) && debugPort > 0 && debugPort <= 65_535, "Use a valid debugging port");
const reservation = createServer();
reservation.listen(debugPort, "127.0.0.1");
await once(reservation, "listening");
await new Promise(resolve => reservation.close(resolve));
const server = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end('<!doctype html><title>Native website fixture</title><h1>Native website fixture</h1>'
    + '<button onclick="this.textContent=\'Clicked\'">Try me</button>');
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const website = `http://127.0.0.1:${server.address().port}/`;
const native = spawn(resolve(process.argv[2]), ["opens_real_webview_preview", "--ignored", "--nocapture"], {
  windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env,
    FILE_PREVIEW_SMOKE_PATH: resolve("README.md"), WEBSITE_PREVIEW_SMOKE_URL: website,
    WEBSITE_PREVIEW_DEBUG_PORT: String(debugPort) },
});
let output = "";
native.stdout.on("data", chunk => { output += chunk; });
native.stderr.on("data", chunk => { output += chunk; });
let browser;
let mainPage;
const watchdog = setTimeout(() => native.kill(), 60_000);
let connectionError;

async function previewPage() {
  let page;
  await expect.poll(() => {
    page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url() === website);
    return Boolean(page);
  }, { timeout: 15_000 }).toBe(true);
  await expect(page.getByRole("heading", { name: "Native website fixture" })).toBeVisible();
  return page;
}

async function checkControls(page) {
  const before = Number(await page.getByLabel("界面心跳").textContent());
  await page.getByRole("button", { name: "切换主机：本地" }).click();
  await expect(page.getByRole("menu", { name: "主机列表" })).toBeVisible();
  await page.getByRole("textbox", { name: "搜索主机" }).press("Escape");
  await expect(page.getByRole("menu", { name: "主机列表" })).toBeHidden();
  const dialog = page.getByRole("dialog", { name: "选择电脑" });
  await page.getByRole("button", { name: "选择电脑", exact: true }).click();
  await dialog.getByRole("button", { name: "关闭" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "选择电脑", exact: true }).click();
  await page.locator(".ant-modal-wrap").click({ position: { x: 10, y: 10 } });
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "立即发送", exact: true }).click();
  await expect(page.getByLabel("操作结果")).toHaveText("queueSendNow");
  await page.getByRole("button", { name: "编辑待发送消息" }).click();
  await expect(page.getByLabel("操作结果")).toHaveText("edited");
  await expect.poll(async () => Number(await page.getByLabel("界面心跳").textContent())).toBeGreaterThan(before);
  const size = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:window|inner_size"));
  assert.ok(size.width > 0, "The native UI thread must still answer window commands");
}

try {
  await expect.poll(async () => {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { timeout: 1_000 }); return true; }
    catch (error) { connectionError = error; return false; }
  }, { timeout: 20_000 }).toBe(true);
  let page;
  await expect.poll(() => {
    page = browser.contexts().flatMap(context => context.pages())
      .find(candidate => candidate.url().includes("file-preview-harness.html?native=1"));
    return Boolean(page);
  }).toBe(true);
  page.setDefaultTimeout(5_000);
  mainPage = page;
  page.on("pageerror", error => console.error("Main page error:", error));
  page.on("console", message => { if (message.type() === "error") console.error(message.text()); });
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole("link", { name: "查看网页" }).click();
    const preview = await previewPage();
    await preview.getByRole("button", { name: "Try me" }).click();
    await expect(preview.getByRole("button", { name: "Clicked" })).toBeVisible();
    await checkControls(page);
    await page.getByRole("button", { name: "最小化详情抽屉" }).click();
    await page.getByRole("button", { name: "恢复预览" }).click();
    await page.getByRole("button", { name: "重新加载网页" }).click();
    await expect.poll(() => preview.isClosed()).toBe(true);
    await expect((await previewPage()).getByRole("button", { name: "Try me" })).toBeVisible();
    await page.getByRole("button", { name: "关闭详情抽屉" }).click();
    await expect(page.getByRole("complementary", { name: "预览详情" })).toHaveCount(0);
    await expect.poll(() => browser.contexts().flatMap(context => context.pages())
      .filter(candidate => candidate.url() === website).length).toBe(0);
  }
  console.log("PASS: native website loads; host picker, dialog dismissal, queue actions and IPC remain responsive.");
  console.log("PASS: minimize, restore, reload, close and reopen release native previews correctly.");
} catch (error) {
  console.error(output);
  if (!browser) console.error(connectionError);
  if (mainPage && !mainPage.isClosed()) console.error(await mainPage.locator("body").innerText());
  throw error;
} finally {
  clearTimeout(watchdog);
  await browser?.close();
  native.kill();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
