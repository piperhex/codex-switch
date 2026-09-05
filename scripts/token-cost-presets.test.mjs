import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const sourcePaths = {
  "./tokenCost": "../apps/desktop/src/utils/tokenCost.ts",
  "./tokenCostPresets": "../apps/desktop/src/utils/tokenCostPresets.ts",
};
const compiled = Object.fromEntries(Object.entries(sourcePaths).map(([name, path]) => [
  name,
  ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText,
]));
const catalog = JSON.parse(readFileSync(
  new URL("../apps/desktop/src/data/tokenCostPresets.json", import.meta.url), "utf8",
));
const verifiedRates = {
  "gpt-5.4-mini": [0.75, 0.075, 4.5],
  "gpt-5.5": [5, 0.5, 30],
  "gpt-5.6-luna": [0.2, 0.02, 1.2],
  "gpt-5.6-sol": [4, 0.4, 20],
  "gpt-5.6-terra": [2, 0.2, 12],
  "gpt-6-astra": [10, 1, 50],
};

function createHarness({ brokenStorage = false } = {}) {
  const stored = new Map();
  const window = new EventTarget();
  window.localStorage = {
    getItem: key => {
      if (brokenStorage) throw new Error("Storage is unavailable");
      return stored.get(key) ?? null;
    },
    setItem: (key, value) => stored.set(key, value),
  };
  const modules = new Map();
  const require = name => {
    if (name === "../data/tokenCostPresets.json") return structuredClone(catalog);
    if (modules.has(name)) return modules.get(name);
    assert.ok(compiled[name], `Unexpected dependency: ${name}`);
    const exports = {};
    modules.set(name, exports);
    runInNewContext(`(function(require, exports) { ${compiled[name]}\n })`, {
      window, CustomEvent: class extends Event {},
    })(require, exports);
    return exports;
  };
  return { window, stored, cost: require("./tokenCost"), presets: require("./tokenCostPresets") };
}

function entry(model = "private-model", providerId = "relay") {
  return {
    id: "request", ts: 1, providerId, provider: "Relay", model,
    inputTokens: 1_000_000, cachedTokens: 200_000, outputTokens: 100_000,
  };
}

function provider(overrides = {}) {
  return { id: "relay", name: "Relay", kind: "custom", modelTokenCosts: {}, ...overrides };
}

function closeTo(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-10, `Expected ${expected}, received ${actual}`);
}

test("contains the six verified official presets and a priced Sol default", () => {
  const { presets } = createHarness();
  assert.equal(presets.TOKEN_COST_PRESETS.length, Object.keys(verifiedRates).length);
  for (const [model, rates] of Object.entries(verifiedRates)) {
    const preset = presets.findTokenCostPreset(model);
    assert.ok(preset, model);
    assert.deepEqual([preset.input, preset.cachedInput, preset.output], rates);
    assert.equal(new URL(preset.sourceUrl).hostname, "developers.openai.com");
  }
  assert.equal(presets.DEFAULT_REFERENCE_MODEL, "gpt-5.6-sol");
  assert.equal(presets.referenceTokenCostPreset().model, "gpt-5.6-sol");
});

test("official preset prices apply to custom, OpenAI, and unassociated usage", () => {
  const { cost } = createHarness();
  for (const [model, [input, cachedInput, output]] of Object.entries(verifiedRates)) {
    const expected = 0.8 * input + 0.2 * cachedInput + 0.1 * output;
    closeTo(cost.estimateTokenCost(entry(model), [provider()]), expected);
    closeTo(cost.estimateTokenCost(entry(model), [provider({ kind: "openai" })]), expected);
    closeTo(cost.estimateTokenCost(entry(model, null), []), expected);
  }
});

test("does not use another API's custom price when only the display name matches", () => {
  const { cost } = createHarness();
  const profiles = [provider({ id: "other-api", modelTokenCosts: { "private-model": 9 } })];
  closeTo(cost.estimateTokenCost(entry(), profiles), 5.28);
  closeTo(cost.estimateTokenCost(entry("private-model", null), profiles), 9.9);
});

test("a specific saved model price wins over an earlier inherited price", () => {
  const { cost } = createHarness();
  cost.saveCustomTokenCostRules([
    { providerId: "relay", model: "gpt-5.6-sol", input: 2, cachedInput: 0.5, output: 3 },
    { providerId: "relay", model: "gpt-5.6-sol-dated", input: 9, cachedInput: 1, output: 13 },
  ]);
  closeTo(cost.estimateTokenCost(entry("gpt-5.6-sol-dated"), [provider()]), 8.7);
  closeTo(cost.estimateTokenCost(entry("gpt-5.6-sol"), [provider()]), 2);
});

test("custom rules override provider prices and official presets, including zero prices", () => {
  const { cost } = createHarness();
  const model = "gpt-5.6-sol";
  const profiles = [provider({ modelTokenCosts: { [model]: 9 } })];
  cost.saveCustomTokenCostRules([
    { providerId: "relay", model, input: 2, cachedInput: 0.5, output: 3 },
  ]);
  closeTo(cost.estimateTokenCost(entry(model), profiles), 2);
  cost.saveCustomTokenCostRules([
    { providerId: "relay", model, input: 0, cachedInput: 0, output: 0 },
  ]);
  assert.equal(cost.estimateTokenCost(entry(model), profiles), 0);
});

test("configured provider model prices take precedence over preset and reference prices", () => {
  const { cost, presets } = createHarness();
  presets.saveTokenCostReferenceModel("gpt-6-astra");
  for (const model of ["gpt-5.6-sol", "private-model"]) {
    closeTo(cost.estimateTokenCost(entry(model), [provider({ modelTokenCosts: { [model]: 2 } })]), 2.2);
    assert.equal(cost.estimateTokenCost(entry(model), [provider({ modelTokenCosts: { [model]: 0 } })]), 0);
  }
});

test("unknown models use Sol by default and update immediately when the reference changes", () => {
  const { cost, presets, window } = createHarness();
  let changes = 0;
  window.addEventListener(presets.TOKEN_COST_REFERENCE_MODEL_EVENT, () => { changes += 1; });
  closeTo(cost.estimateTokenCost(entry(), [provider()]), 5.28);
  closeTo(cost.estimateTokenCost(entry("private-model", null), []), 5.28);
  presets.saveTokenCostReferenceModel("gpt-5.6-terra");
  assert.equal(changes, 1);
  assert.equal(presets.loadTokenCostReferenceModel(), "gpt-5.6-terra");
  closeTo(cost.estimateTokenCost(entry(), [provider()]), 2.84);
  closeTo(cost.estimateTokenCost(entry("private-model", null), []), 2.84);
  closeTo(cost.estimateTokenCost(entry("gpt-5.6-sol"), [provider()]), 5.28);
});

test("Spark is unpriced and uses an explicitly selected reference rather than another Codex price", () => {
  const { cost, presets } = createHarness();
  const spark = "gpt-5.3-codex-spark";
  assert.ok(presets.UNPRICED_PRESET_MODELS.includes(spark));
  assert.equal(presets.findTokenCostPreset(spark), undefined);
  closeTo(cost.estimateTokenCost(entry(spark), [provider()]), 5.28);
  presets.saveTokenCostReferenceModel("gpt-5.6-terra");
  closeTo(cost.estimateTokenCost(entry(spark), [provider()]), 2.84);
  presets.saveTokenCostReferenceModel(spark);
  assert.equal(presets.loadTokenCostReferenceModel(), "gpt-5.6-terra");
});

test("invalid or unreadable saved prices and references fall back to Sol", () => {
  for (const invalid of ["not-a-model", "gpt-5.3-codex-spark", "{invalid json"]) {
    const { cost, presets, stored } = createHarness();
    stored.set(presets.TOKEN_COST_REFERENCE_MODEL_STORAGE_KEY, invalid);
    stored.set(cost.TOKEN_COST_CUSTOM_RULES_STORAGE_KEY, invalid);
    assert.equal(presets.loadTokenCostReferenceModel(), "gpt-5.6-sol");
    closeTo(cost.estimateTokenCost(entry(), [provider()]), 5.28);
  }
  const { cost, presets } = createHarness({ brokenStorage: true });
  assert.equal(presets.loadTokenCostReferenceModel(), "gpt-5.6-sol");
  closeTo(cost.estimateTokenCost(entry(), [provider()]), 5.28);
});

test("versioned preset models retain their most specific price", () => {
  const { cost, presets } = createHarness();
  for (const model of ["gpt-5.4-mini", "gpt-5.5", "gpt-5.6-sol"]) {
    const versioned = ` ${model.toUpperCase()}-2026-09-01 `;
    assert.equal(presets.findTokenCostPreset(versioned).model, model);
    const [input, cachedInput, output] = verifiedRates[model];
    closeTo(cost.estimateTokenCost(entry(versioned), [provider()]), 0.8 * input + 0.2 * cachedInput + 0.1 * output);
  }
});

test("the GPT-5.6 alias retains Sol pricing when the fallback reference changes", () => {
  const { cost, presets } = createHarness();
  presets.saveTokenCostReferenceModel("gpt-5.6-terra");
  assert.equal(presets.findTokenCostPreset("gpt-5.6").model, "gpt-5.6-sol");
  closeTo(cost.estimateTokenCost(entry("gpt-5.6"), [provider()]), 5.28);
});

test("versioned model names still use provider-specific custom rules", () => {
  const { cost } = createHarness();
  cost.saveCustomTokenCostRules([
    { providerId: "relay", model: "gpt-5.6-sol", input: 2, cachedInput: 0.5, output: 3 },
  ]);
  closeTo(cost.estimateTokenCost(entry("GPT-5.6-SOL-2026-09-01"), [provider()]), 2);
});
