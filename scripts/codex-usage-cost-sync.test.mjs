import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const sourcePaths = {
  "./tokenCost": "../apps/desktop/src/utils/tokenCost.ts",
  "./tokenCostPresets": "../apps/desktop/src/utils/tokenCostPresets.ts",
  "./tokenCostFastMode": "../apps/desktop/src/utils/tokenCostFastMode.ts",
  "../pages/providers/providerUtils": "../apps/desktop/src/pages/providers/providerUtils.ts",
  sync: "../apps/desktop/src/utils/codexUsageCostSync.ts",
};
const compiled = Object.fromEntries(Object.entries(sourcePaths).map(([name, path]) => [
  name,
  ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText,
]));

function createHarness({ desktop = true } = {}) {
  const stored = new Map();
  const timers = new Map();
  const calls = [];
  const window = new EventTarget();
  const warnings = [];
  let timerId = 0;
  if (desktop) window.__TAURI_INTERNALS__ = {};
  window.localStorage = {
    getItem: key => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
  };
  window.setTimeout = (callback, delay) => {
    timers.set(++timerId, { callback, delay });
    return timerId;
  };
  window.clearTimeout = id => timers.delete(id);
  const modules = new Map();
  const require = name => {
    if (name === "../data/tokenCostPresets.json") {
      return JSON.parse(readFileSync(new URL("../apps/desktop/src/data/tokenCostPresets.json", import.meta.url), "utf8"));
    }
    if (name === "@tauri-apps/api/core") return {
      invoke: (command, args) => new Promise((resolve, reject) => {
        calls.push({ command, rates: args.rates, resolve, reject });
      }),
    };
    if (modules.has(name)) return modules.get(name);
    const exports = {};
    modules.set(name, exports);
    runInNewContext(`(function(require, exports) { ${compiled[name]}\n })`, {
      window, CustomEvent: class extends Event {}, console: { warn: value => warnings.push(value) },
    })(require, exports);
    return exports;
  };
  return { window, timers, calls, warnings, require };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test("coalesces edits during an active request and sends the latest prices", async () => {
  const harness = createHarness();
  const { installCodexUsageCostSync } = harness.require("sync");
  const { persistStoredModelTokenCosts } = harness.require("../pages/providers/providerUtils");
  const { saveCustomTokenCostRules } = harness.require("./tokenCost");
  const { saveTokenCostReferenceModel } = harness.require("./tokenCostPresets");
  const { saveFastModeCostMultiplier } = harness.require("./tokenCostFastMode");
  const stop = installCodexUsageCostSync();
  persistStoredModelTokenCosts("relay", { model: 2 });
  persistStoredModelTokenCosts("relay", { model: 3 });
  saveCustomTokenCostRules([{ providerId: "relay", model: "model", input: 4, cachedInput: 1, output: 5 }]);
  saveTokenCostReferenceModel("gpt-5.6-terra");
  saveFastModeCostMultiplier(3);
  assert.equal(harness.calls.length, 1);
  harness.calls[0].resolve();
  await flush();
  assert.equal(harness.calls.length, 2);
  assert.equal(harness.calls[1].command, "set_codex_usage_cost_rates");
  assert.equal(harness.calls[1].rates.modelTokenCosts.relay.model, 3);
  assert.equal(harness.calls[1].rates.customRules[0].input, 4);
  assert.equal(harness.calls[0].rates.referenceModel, "gpt-5.6-sol");
  assert.equal(harness.calls[1].rates.referenceModel, "gpt-5.6-terra");
  assert.equal(harness.calls[0].rates.fastModeMultiplier, 2.5);
  assert.equal(harness.calls[1].rates.fastModeMultiplier, 3);
  stop();
  persistStoredModelTokenCosts("relay", { model: 10 });
  harness.calls[1].resolve();
  await flush();
  assert.equal(harness.calls.length, 2);
  assert.equal(harness.timers.size, 0);
});

test("reloads cached rules when an auxiliary window changes storage", async () => {
  const harness = createHarness();
  const { installCodexUsageCostSync } = harness.require("sync");
  const { TOKEN_COST_CUSTOM_RULES_STORAGE_KEY } = harness.require("./tokenCost");
  const stop = installCodexUsageCostSync();
  harness.calls[0].resolve();
  await flush();
  harness.window.localStorage.setItem(TOKEN_COST_CUSTOM_RULES_STORAGE_KEY, JSON.stringify([
    { providerId: "relay", model: "model", input: 7, cachedInput: 1, output: 8 },
  ]));
  const event = new Event("storage");
  event.key = TOKEN_COST_CUSTOM_RULES_STORAGE_KEY;
  event.storageArea = harness.window.localStorage;
  harness.window.dispatchEvent(event);
  assert.equal(harness.calls.length, 2);
  assert.equal(harness.calls[1].rates.customRules[0].input, 7);
  stop();
  harness.calls[1].resolve();
  await flush();
});

test("retries a failed sync and clears retries when the window unmounts", async () => {
  const harness = createHarness();
  const stop = harness.require("sync").installCodexUsageCostSync();
  harness.calls[0].reject(new Error("temporarily unavailable"));
  await flush();
  assert.equal(harness.warnings.length, 1);
  assert.equal(harness.timers.size, 1);
  const [timerId, timer] = [...harness.timers][0];
  assert.equal(timer.delay, 30_000);
  harness.timers.delete(timerId);
  timer.callback();
  assert.equal(harness.calls.length, 2);
  harness.calls[1].reject(new Error("temporarily unavailable"));
  await flush();
  stop();
  assert.equal(harness.timers.size, 0);
});

test("does not send desktop commands in a web browser", () => {
  const harness = createHarness({ desktop: false });
  assert.equal(harness.require("sync").installCodexUsageCostSync(), undefined);
  assert.equal(harness.calls.length, 0);
});
