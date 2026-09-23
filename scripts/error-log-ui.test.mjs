import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function loadApi(backend) {
  const source = readFileSync(new URL("../apps/desktop/src/api/errorLogs.ts", import.meta.url), "utf8");
  const exports = {};
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  runInNewContext(output, { exports, require: () => backend });
  return exports;
}

test("log APIs preserve cursor compatibility and send numbered pagination to the backend", async () => {
  const calls = [];
  const api = loadApi({ hasLocalBackend: true, invoke: async (...args) => { calls.push(args); } });
  await api.listErrorLogs({ limit: 50, beforeId: 10, source: "proxy" });
  await api.listErrorLogs({ limit: 10, source: "toast", pagination: { page: 3, snapshotId: 100 } });
  await api.recordToastLog("Message");
  await api.clearErrorLogs();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ["list_error_logs", { limit: 50, beforeId: 10, source: "proxy" }],
    ["list_error_logs", { limit: 10, source: "toast", pagination: { page: 3, snapshotId: 100 } }],
    ["record_toast_log", { message: "Message" }],
    ["clear_error_logs"],
  ]);
});

test("browser preview returns an empty page without sending native commands", async () => {
  const api = loadApi({ hasLocalBackend: false, invoke: () => assert.fail("Unexpected native command") });
  assert.deepEqual(JSON.parse(JSON.stringify(await api.listErrorLogs())), {
    entries: [], hasMore: false, total: 0, page: 1, snapshotId: null,
  });
  await api.recordToastLog("Message");
  await api.clearErrorLogs();
});

test("blank toast messages do not send native commands", async () => {
  const api = loadApi({ hasLocalBackend: true, invoke: () => assert.fail("Unexpected blank message") });
  await api.recordToastLog("   ");
});
