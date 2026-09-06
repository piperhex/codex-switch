import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const sourcePath = new URL(
  "../apps/desktop/src-tauri/src/dream_skin_native/model_refresh.rs",
  import.meta.url,
);
const rustSource = readFileSync(sourcePath, "utf8");
const upstreamModels = ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];
const defaultModel = "gpt-5.6-sol";
const modelQueryKey = ["models", "list", "local", "no-auth", 100];
const patchStateKey = "__CODEX_SWITCH_MODEL_QUERY_PATCH__";
const selectModels = response => ({ models: response?.data ?? [] });
const selectDefaultModel = response => ({
  models: (response?.data ?? []).filter(model => model.id === defaultModel),
});

function extractSource(pattern, description) {
  const match = rustSource.match(pattern);
  assert.ok(match, `Unable to find ${description} in ${sourcePath.pathname}`);
  return match[1];
}

const observerHelpers = extractSource(
  /const CODEX_MODEL_OBSERVER_PATCH_HELPERS: &str = r#"([\s\S]*?)"#;/,
  "the model observer helpers",
);
const expressionTemplate = extractSource(
  /r#"(\(async \(\) => [\s\S]*?\}\}\)\(\))"#/,
  "the model refresh expression",
);

function modelRefreshExpression(models) {
  const substitutions = {
    models: JSON.stringify(models),
    fast_mode_models: "[]",
    image_input_models: "[]",
    selected_model: JSON.stringify(models[0] ?? defaultModel),
    reasoning_efforts: "{}",
    fallback_query_key: JSON.stringify(modelQueryKey),
    composer_status_allowed_global: "__CODEX_SWITCH_COMPOSER_STATUS_ALLOWED__",
    composer_status_observer_global: "__CODEX_SWITCH_COMPOSER_STATUS_OBSERVER__",
    observer_patch_helpers: observerHelpers,
    // The DOM speed overlay is tested separately in codex-usage-overlay.test.mjs.
    speed_selector_overlay: "",
  };
  return expressionTemplate.replace(/\{\{|\}\}|\{([a-z_]+)\}/g, (token, key) => {
    if (token === "{{") return "{";
    if (token === "}}") return "}";
    assert.ok(Object.hasOwn(substitutions, key), `Unexpected Rust format placeholder: ${key}`);
    return substitutions[key];
  });
}

function modelResponse(models) {
  return {
    data: models.map(model => ({ id: model, model, displayName: model })),
    nextCursor: null,
  };
}

// This harness exercises the production renderer expression, not the Rust request builder.
// Query/observer methods model only the cache and select contracts used by that expression;
// pending fetches are controllable promises, not real network, React, or Windows UI work.
class ModelObserver {
  constructor(query, select = selectModels) {
    this.query = query;
    this.options = { select };
  }

  setOptions(options) {
    this.options = options;
  }

  modelIds() {
    return Array.from(this.options.select(this.query.state.data).models, model => model.id);
  }
}

class ModelQuery {
  constructor({ models = upstreamModels, queryKey = modelQueryKey } = {}) {
    this.queryKey = [...queryKey];
    this.state = { data: modelResponse(models) };
    this.observers = [];
  }

  addObserver(observer) {
    this.observers.push(observer);
  }

  isActive() {
    return this.observers.length > 0;
  }

  modelIds() {
    return Array.from(this.state.data?.data ?? [], model => model.id);
  }
}

class QueryCache {
  constructor(query) {
    this.queries = [query];
    this.subscribers = new Set();
  }

  getAll() {
    return this.queries;
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  notify(type, query) {
    for (const callback of this.subscribers) callback({ type, query });
  }

  add(query) {
    this.queries.push(query);
    this.notify("added", query);
  }
}

class QueryClient {
  constructor(query) {
    this.cache = new QueryCache(query);
    this.upstreamModels = upstreamModels;
    this.fetchGate = null;
    this.pendingRequests = 0;
    this.resetCount = 0;
  }

  getQueryCache() {
    return this.cache;
  }

  async refetch(query) {
    this.pendingRequests += 1;
    try {
      await this.fetchGate;
      query.state.data = modelResponse(this.upstreamModels);
      this.cache.notify("updated", query);
    } finally {
      this.pendingRequests -= 1;
    }
  }

  async invalidateQueries({ predicate, refetchType = "active" }) {
    const targets = this.cache.getAll().filter(query =>
      predicate(query) && (refetchType === "all" || query.isActive()));
    await Promise.all(targets.map(query => this.refetch(query)));
  }

  async resetQueries({ predicate }) {
    this.resetCount += 1;
    const targets = this.cache.getAll().filter(predicate);
    for (const query of targets) query.state.data = undefined;
    await Promise.all(targets.filter(query => query.isActive()).map(query => this.refetch(query)));
  }

  setQueryData(key, updater) {
    const query = this.cache.getAll().find(candidate =>
      JSON.stringify(candidate.queryKey) === JSON.stringify(key));
    assert.ok(query, "This scenario must seed its model query before refreshing");
    query.state.data = updater(query.state.data);
    this.cache.notify("updated", query);
  }
}

function createHarness({ models = upstreamModels, select = selectModels } = {}) {
  const query = new ModelQuery({ models });
  const observer = new ModelObserver(query, select);
  query.addObserver(observer);
  const client = new QueryClient(query);
  const window = { __codexRoot: { _internalRoot: { current: { memoizedProps: { client } } } } };
  return {
    client, query, observer, window,
    refresh: modelsToInject => runInNewContext(modelRefreshExpression(modelsToInject), { window, Symbol }),
    addObserver(target = query, selector = selectModels) {
      const added = new ModelObserver(target, selector);
      target.addObserver(added);
      return added;
    },
  };
}

test("an upstream catalog replaces the stale single-model picker list", async () => {
  const harness = createHarness({ models: [defaultModel], select: selectDefaultModel });
  assert.deepEqual(harness.observer.modelIds(), [defaultModel]);

  const result = await harness.refresh(upstreamModels);

  assert.equal(result.refreshed, true);
  assert.equal(result.count, upstreamModels.length);
  assert.deepEqual(harness.query.modelIds(), upstreamModels);
  assert.deepEqual(harness.observer.modelIds(), upstreamModels);
});

test("an empty fallback request removes an old single-model patch and reloads the upstream", async () => {
  const harness = createHarness();
  await harness.refresh([defaultModel]);
  assert.deepEqual(harness.observer.modelIds(), [defaultModel]);

  await harness.refresh([]);

  assert.equal(harness.client.resetCount, 1);
  assert.equal(harness.window[patchStateKey], undefined);
  assert.equal(Object.hasOwn(harness.query, "addObserver"), false);
  assert.equal(Object.hasOwn(harness.observer, "setOptions"), false);
  assert.deepEqual(harness.query.modelIds(), upstreamModels);
  assert.deepEqual(harness.observer.modelIds(), upstreamModels);
  const laterObserver = harness.addObserver();
  harness.client.upstreamModels = [...upstreamModels, "upstream-new-model"];
  await harness.client.refetch(harness.query);
  assert.deepEqual(laterObserver.modelIds(), harness.client.upstreamModels);
  assert.deepEqual(harness.observer.modelIds(), harness.client.upstreamModels);
});

test("an empty fallback also clears injected data from inactive picker queries", async () => {
  const harness = createHarness();
  await harness.refresh([defaultModel]);
  harness.query.observers = [];

  await harness.refresh([]);

  assert.equal(harness.query.state.data, undefined);
  const mountedObserver = harness.addObserver();
  await harness.client.refetch(harness.query);
  assert.deepEqual(mountedObserver.modelIds(), upstreamModels);
  assert.equal(Object.hasOwn(mountedObserver, "setOptions"), false);
});

test("later observers and query refreshes keep the complete upstream catalog visible", async () => {
  const harness = createHarness({ select: selectDefaultModel });
  await harness.refresh(upstreamModels);
  const laterObserver = harness.addObserver(harness.query, selectDefaultModel);
  const laterQuery = new ModelQuery({ queryKey: ["models", "list", "local", "api-key", 100] });
  harness.client.cache.add(laterQuery);
  const laterQueryObserver = harness.addObserver(laterQuery, selectDefaultModel);

  await harness.client.invalidateQueries({ predicate: () => true });
  harness.observer.setOptions({ select: selectDefaultModel });

  for (const observer of [harness.observer, laterObserver, laterQueryObserver]) {
    assert.deepEqual(observer.modelIds(), upstreamModels);
  }
});

test("a pending poll does not narrow an already refreshed upstream picker", async () => {
  const harness = createHarness({ select: selectDefaultModel });
  await harness.refresh(upstreamModels);
  let releaseFetch;
  harness.client.fetchGate = new Promise(resolve => { releaseFetch = resolve; });
  const refresh = harness.refresh(upstreamModels);
  assert.equal(harness.client.pendingRequests, 1);
  assert.deepEqual(harness.observer.modelIds(), upstreamModels);
  assert.deepEqual(harness.addObserver(harness.query, selectDefaultModel).modelIds(), upstreamModels);

  releaseFetch();
  await refresh;

  assert.equal(harness.client.pendingRequests, 0);
  assert.deepEqual(harness.observer.modelIds(), upstreamModels);
});

test("a normal Provider still limits the picker to its configured models after polling", async () => {
  const harness = createHarness();
  const configuredModels = [defaultModel, "gpt-5.6-terra"];
  await harness.refresh(configuredModels);
  assert.deepEqual(harness.query.modelIds(), configuredModels);

  await harness.client.refetch(harness.query);

  assert.deepEqual(harness.query.modelIds(), upstreamModels);
  assert.deepEqual(harness.observer.modelIds(), configuredModels);
  assert.deepEqual(harness.addObserver().modelIds(), configuredModels);
});
