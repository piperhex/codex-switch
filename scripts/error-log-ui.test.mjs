import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function loadModule(relativePath, dependencies = {}, globals = {}) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const exports = {};
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  runInNewContext(output, { exports, require: name => dependencies[name], ...globals });
  return exports;
}

const merge = loadModule("../apps/desktop/src/components/ErrorLogManager/logEntries.ts");
const entry = id => ({ id, createdAt: "2026-09-07T00:00:00Z", source: "toast", message: String(id) });
const page = (ids, hasMore = false) => ({ entries: ids.map(entry), hasMore });
const ids = result => Array.from(result.entries, item => item.id);
const drain = () => new Promise(resolve => setImmediate(resolve));

test("live refresh keeps loaded history in descending order without duplicates", () => {
  const result = merge.mergeLatestLogPage(page([5, 4, 3, 2], true), page([7, 6, 5, 4], true));
  assert.deepEqual(ids(result), [7, 6, 5, 4, 3, 2]);
  assert.equal(result.hasMore, true);
});

test("a burst larger than one page resets the cursor so older entries cannot be skipped", () => {
  const result = merge.mergeLatestLogPage(page([5, 4, 3]), page([10, 9, 8], true));
  assert.deepEqual(ids(result), [10, 9, 8]);
  assert.equal(result.hasMore, true);
});

test("empty and replaced histories clear stale entries", () => {
  assert.deepEqual(ids(merge.mergeLatestLogPage(page([5, 4]), page([]))), []);
  assert.deepEqual(ids(merge.mergeLatestLogPage(page([5, 4]), page([2, 1]))), [2, 1]);
});

test("merging beyond the retention boundary keeps only the latest 5000 distinct entries", () => {
  const current = Array.from({ length: 5000 }, (_, index) => entry(5000 - index));
  const atLimit = merge.mergeLogEntries(current, [entry(5000)]);
  assert.equal(atLimit.length, 5000);
  assert.equal(atLimit.at(-1).id, 1);
  const overflow = merge.mergeLogEntries(current, [entry(5001), entry(5000)]);
  assert.equal(overflow.length, 5000);
  assert.equal(overflow[0].id, 5001);
  assert.equal(overflow.at(-1).id, 2);
});

test("log APIs use the shared desktop and hosted backend commands", async () => {
  const calls = [];
  const api = loadModule("../apps/desktop/src/api/errorLogs.ts", {
    "./backend": { hasLocalBackend: true, invoke: async (...args) => { calls.push(args); return page([]); } },
  });
  await api.listErrorLogs({ limit: 50, beforeId: 10, source: "proxy" });
  await api.recordToastLog("Message");
  await api.clearErrorLogs();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ["list_error_logs", { limit: 50, beforeId: 10, source: "proxy" }],
    ["record_toast_log", { message: "Message" }],
    ["clear_error_logs"],
  ]);
});

test("browser preview and blank toast messages do not send native commands", async () => {
  const api = loadModule("../apps/desktop/src/api/errorLogs.ts", {
    "./backend": { hasLocalBackend: false, invoke: () => assert.fail("Unexpected native command") },
  });
  assert.deepEqual(ids(await api.listErrorLogs()), []);
  await api.recordToastLog("Message");
  await api.clearErrorLogs();
  const localApi = loadModule("../apps/desktop/src/api/errorLogs.ts", {
    "./backend": { hasLocalBackend: true, invoke: () => assert.fail("Unexpected blank message") },
  });
  await localApi.recordToastLog("   ");
});

function createHookHarness() {
  const hooks = [];
  const timers = new Map();
  const requests = [];
  const pendingEffects = [];
  let cursor = 0;
  let writes = 0;
  let clearCalls = 0;
  const same = (left, right) => left?.length === right.length && left.every((value, index) => value === right[index]);
  const react = {
    useState(initial) {
      const index = cursor++;
      hooks[index] ??= { value: initial };
      return [hooks[index].value, value => { writes += 1; hooks[index].value = value; }];
    },
    useRef(initial) { const index = cursor++; return hooks[index] ??= { current: initial }; },
    useCallback(callback, dependencies) {
      const index = cursor++;
      if (!same(hooks[index]?.dependencies, dependencies)) hooks[index] = { callback, dependencies };
      return hooks[index].callback;
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      if (same(hooks[index]?.dependencies, dependencies)) return;
      pendingEffects.push(() => {
        hooks[index]?.cleanup?.();
        hooks[index] = { dependencies, cleanup: effect() };
      });
    },
  };
  const module = loadModule("../apps/desktop/src/components/ErrorLogManager/useErrorLogs.ts", {
    react,
    "./logEntries": merge,
    "../../api/errorLogs": {
      listErrorLogs: query => new Promise((resolve, reject) => requests.push({ query, resolve, reject })),
      clearErrorLogs: async () => { clearCalls += 1; },
    },
  }, {
    window: {
      setInterval: callback => { const id = Symbol(); timers.set(id, callback); return id; },
      clearInterval: id => timers.delete(id),
    },
  });
  return {
    requests, timers,
    render() {
      cursor = 0;
      const result = module.useErrorLogs();
      pendingEffects.splice(0).forEach(run => run());
      return result;
    },
    tick() { timers.forEach(callback => callback()); },
    close() { hooks.forEach(hook => hook.cleanup?.()); },
    writes: () => writes,
    clearCalls: () => clearCalls,
  };
}

test("polling remains single-flight and closing prevents stale state updates", async () => {
  const harness = createHookHarness();
  harness.render();
  harness.tick();
  harness.tick();
  assert.equal(harness.requests.length, 1);
  harness.close();
  assert.equal(harness.timers.size, 0);
  const writes = harness.writes();
  harness.requests[0].resolve(page([3, 2, 1]));
  await drain();
  assert.equal(harness.writes(), writes);
});

test("loading more uses the oldest cursor and live refresh retains the appended page", async () => {
  const harness = createHookHarness();
  harness.render();
  harness.requests[0].resolve(page([5, 4], true));
  await drain();
  const older = harness.render().load("more");
  assert.equal(harness.requests[1].query.beforeId, 4);
  harness.requests[1].resolve(page([3, 2]));
  await older;
  harness.tick();
  harness.requests[2].resolve(page([6, 5], true));
  await drain();
  assert.deepEqual(ids(harness.render()), [6, 5, 4, 3, 2]);
  assert.equal(harness.render().hasMore, false);
});

test("source changes ignore the old request and the next tick loads the selected source", async () => {
  const harness = createHookHarness();
  harness.render().setFilter("proxy");
  harness.render();
  harness.requests[0].resolve(page([7]));
  await drain();
  assert.deepEqual(ids(harness.render()), []);
  harness.tick();
  assert.equal(harness.requests[1].query.source, "proxy");
});

test("clear confirmation pauses polling and successful clear removes visible logs", async () => {
  const harness = createHookHarness();
  harness.render();
  harness.requests[0].resolve(page([3, 2]));
  await drain();
  const logs = harness.render();
  logs.setPollingPaused(true);
  harness.tick();
  assert.equal(harness.requests.length, 1);
  assert.equal(await logs.clear(), true);
  assert.equal(harness.clearCalls(), 1);
  assert.deepEqual(ids(harness.render()), []);
});
