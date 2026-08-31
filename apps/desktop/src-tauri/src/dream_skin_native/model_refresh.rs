#[cfg(test)]
const CODEX_MODEL_QUERY_PREFIX: [&str; 2] = ["models", "list"];
// Codex Desktop keys an unauthenticated model query with authMethod ?? "no-auth".
// Seeding that exact cache entry lets a picker mounted after this refresh reuse the injected models.
const CODEX_MODEL_QUERY_HOST: &str = "local";
const CODEX_MODEL_QUERY_NO_AUTH: &str = "no-auth";
const CODEX_MODEL_QUERY_LIMIT: u16 = 100;

/// Outcome reported by the Codex renderer after refreshing its model cache.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct CodexModelRefreshResult {
    pub(crate) refreshed: bool,
    pub(crate) reason: Option<String>,
}

fn codex_model_fallback_query_key() -> Value {
    json!([
        "models",
        "list",
        CODEX_MODEL_QUERY_HOST,
        CODEX_MODEL_QUERY_NO_AUTH,
        CODEX_MODEL_QUERY_LIMIT,
    ])
}

const CODEX_MODEL_OBSERVER_PATCH_HELPERS: &str = r#"
  const patchStateKey = "__CODEX_SWITCH_MODEL_QUERY_PATCH__";
  const queryPatchSymbol = Symbol.for("codex-switch.models.query-patch");
  const observerPatchSymbol = Symbol.for("codex-switch.models.observer-patch");
  const wrappedSelectSymbol = Symbol.for("codex-switch.models.wrapped-select");
  const restoreObserver = observer => {
    const patch = observer?.[observerPatchSymbol];
    if (!patch) return;
    patch.originalSetOptions({ ...observer.options, select: patch.originalSelect });
    delete observer.setOptions;
    delete observer[observerPatchSymbol];
  };
  const restoreQuery = query => {
    for (const observer of query?.observers ?? []) restoreObserver(observer);
    if (!query?.[queryPatchSymbol]) return;
    delete query.addObserver;
    delete query[queryPatchSymbol];
  };
  const clearModelQueryPatch = () => {
    const state = window[patchStateKey];
    if (!state) return;
    state.unsubscribe?.();
    for (const query of state.queries ?? []) restoreQuery(query);
    delete window[patchStateKey];
  };
  const wrapSelect = originalSelect => {
    const wrappedSelect = input => {
      const base = typeof originalSelect === "function" ? originalSelect(input) : input;
      const state = window[patchStateKey];
      if (!state?.active || !Array.isArray(state.models)) return base;
      const models = state.models;
      const supportsEffort = effort => models.some(model =>
        model.supportedReasoningEfforts?.some(item => item.reasoningEffort === effort)
      );
      return {
        ...(base && typeof base === "object" ? base : {}),
        models,
        defaultModel: models.find(model => model.isDefault) ?? models[0] ?? null,
        hasModelSupportingMaxReasoningEffort: supportsEffort("max"),
        hasModelSupportingUltraReasoningEffort: supportsEffort("ultra"),
      };
    };
    wrappedSelect[wrappedSelectSymbol] = true;
    return wrappedSelect;
  };
  const patchObserver = observer => {
    if (!observer || typeof observer.setOptions !== "function") return;
    let patch = observer[observerPatchSymbol];
    if (!patch) {
      patch = {
        originalSelect: observer.options?.select ?? null,
        originalSetOptions: observer.setOptions.bind(observer),
      };
      observer[observerPatchSymbol] = patch;
      observer.setOptions = options => {
        if (!options?.select?.[wrappedSelectSymbol]) {
          patch.originalSelect = options?.select ?? null;
        }
        return patch.originalSetOptions({
          ...options,
          select: wrapSelect(patch.originalSelect),
        });
      };
    }
    observer.setOptions(observer.options);
  };
  const patchQuery = query => {
    if (!matchesModelsQuery(query)) return;
    patchState.queries.add(query);
    if (!query[queryPatchSymbol]) {
      const originalAddObserver = query.addObserver.bind(query);
      query[queryPatchSymbol] = { originalAddObserver };
      query.addObserver = observer => {
        const result = originalAddObserver(observer);
        patchObserver(observer);
        return result;
      };
    }
    for (const observer of query.observers ?? []) patchObserver(observer);
  };
"#;

const CODEX_RENDERER_CAPABILITY_PATCH_HELPER: &str = r#"
  const patchRendererCapabilities = (rootValue, expectedModels) => {
    const queue = [rootValue];
    const seen = new Set();
    let changed = false;
    while (queue.length && seen.size < 50000) {
      const value = queue.shift();
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      if (Object.prototype.hasOwnProperty.call(value, "authMethod") &&
          (Object.prototype.hasOwnProperty.call(value, "requiresAuth") ||
           Object.prototype.hasOwnProperty.call(value, "hasChatGptToken"))) {
        if (value.authMethod !== "chatgpt") {
          value.authMethod = "chatgpt";
          changed = true;
        }
      }
      for (const key of ["use_hidden_models", "useHiddenModels"]) {
        if (value[key] === true) {
          value[key] = false;
          changed = true;
        }
      }
      for (const key of ["available_models", "availableModels"]) {
        if (Array.isArray(value[key])) {
          const models = new Set(value[key].filter(model => typeof model === "string"));
          for (const model of expectedModels) models.add(model);
          const expanded = [...models];
          if (expanded.length !== value[key].length ||
              expanded.some((model, index) => model !== value[key][index])) {
            value[key] = expanded;
            changed = true;
          }
        }
      }
      for (const key of Object.keys(value).slice(0, 100)) {
        try { queue.push(value[key]); } catch (_) {}
      }
    }
    return changed;
  };
  const patchFastRequirement = value => {
    if (!value || typeof value !== "object") return { value, changed: false };
    if (Array.isArray(value)) {
      let changed = false;
      const next = value.map(item => {
        const patched = patchFastRequirement(item);
        changed ||= patched.changed;
        return patched.value;
      });
      return { value: changed ? next : value, changed };
    }
    let changed = false;
    const next = { ...value };
    for (const [key, item] of Object.entries(value)) {
      if ((key === "fast_mode" || key === "fastMode") && item === false) {
        next[key] = true;
        changed = true;
        continue;
      }
      const patched = patchFastRequirement(item);
      if (patched.changed) {
        next[key] = patched.value;
        changed = true;
      }
    }
    return { value: changed ? next : value, changed };
  };
  const patchConfigQuery = (query, queryClient) => {
    if (!query || !matchesConfigQuery(query)) return;
    queryClient.setQueryData(query.queryKey, current => patchFastRequirement(current).value);
  };
"#;

fn codex_model_refresh_expression(
    models: &[String],
    fast_mode_models: &[String],
    image_input_models: &[String],
    model_reasoning_efforts: &crate::models::ModelReasoningEfforts,
    selected_model: &str,
    reasoning_profile: crate::providers::ReasoningEffortProfile,
) -> Result<String, String> {
    let reasoning_efforts = models
        .iter()
        .map(|model| {
            let profile =
                crate::providers::reasoning_effort_profile_for_model(model, reasoning_profile);
            let efforts = crate::providers::supported_reasoning_levels_for_model(
                model,
                profile,
                model_reasoning_efforts,
            )
            .as_array()
            .into_iter()
            .flatten()
            .map(|level| {
                json!({
                    "reasoningEffort": level["effort"],
                    "description": level["description"],
                })
            })
            .collect::<Vec<_>>();
            (model.clone(), Value::Array(efforts))
        })
        .collect::<Map<String, Value>>();
    let models = serde_json::to_string(models)
        .map_err(|error| format!("Failed to prepare the Codex model list: {error}"))?;
    let fast_mode_models = serde_json::to_string(fast_mode_models)
        .map_err(|error| format!("Failed to prepare Fast-capable models: {error}"))?;
    let image_input_models = serde_json::to_string(image_input_models)
        .map_err(|error| format!("Failed to prepare image-capable models: {error}"))?;
    let selected_model = serde_json::to_string(selected_model)
        .map_err(|error| format!("Failed to prepare the selected Codex model: {error}"))?;
    let reasoning_efforts = serde_json::to_string(&reasoning_efforts)
        .map_err(|error| format!("Failed to prepare reasoning efforts: {error}"))?;
    let fallback_query_key = serde_json::to_string(&codex_model_fallback_query_key())
        .map_err(|error| format!("Failed to prepare the fallback model query: {error}"))?;
    let observer_patch_helpers = CODEX_MODEL_OBSERVER_PATCH_HELPERS;
    let renderer_capability_patch_helper = CODEX_RENDERER_CAPABILITY_PATCH_HELPER;
    Ok(format!(
        r#"(async () => {{
  const expectedModels = {models};
  const fastModeModels = new Set({fast_mode_models});
  const imageInputModels = new Set({image_input_models});
  const selectedModel = {selected_model};
  const supportedReasoningEffortsByModel = {reasoning_efforts};
  const root = window.__codexRoot;
  if (!root || !Array.isArray(expectedModels)) {{
    return {{ refreshed: false, reason: "unavailable" }};
  }}
{renderer_capability_patch_helper}
  patchRendererCapabilities(root._internalRoot?.current ?? root, expectedModels);
  const queue = [root._internalRoot?.current ?? root];
  const seen = new Set();
  let queryClient = null;
  while (queue.length && seen.size < 50000) {{
    const fiber = queue.shift();
    if (!fiber || typeof fiber !== "object" || seen.has(fiber)) continue;
    seen.add(fiber);
    const candidates = [
      fiber.memoizedProps?.client,
      fiber.pendingProps?.client,
      fiber.memoizedState?.client,
    ];
    queryClient = candidates.find(candidate =>
      candidate && typeof candidate.getQueryCache === "function" &&
      typeof candidate.invalidateQueries === "function" &&
      typeof candidate.setQueryData === "function"
    ) ?? null;
    if (queryClient) break;
    if (fiber.child) queue.push(fiber.child);
    if (fiber.sibling) queue.push(fiber.sibling);
  }}
  if (!queryClient) return {{ refreshed: false, reason: "query-client-not-found" }};

  const matchesModelsQuery = query => Array.isArray(query.queryKey) &&
    query.queryKey[0] === "models" && query.queryKey[1] === "list";
  const matchesConfigQuery = query => Array.isArray(query.queryKey) && (
    query.queryKey[0] === "user-saved-config" ||
    (query.queryKey[0] === "config" &&
      (query.queryKey[1] === "user" || query.queryKey[1] === "read-response"))
  );
{observer_patch_helpers}
  const queryCache = queryClient.getQueryCache();
  const patchConfigQueries = () => {{
    for (const query of queryCache.getAll()) patchConfigQuery(query, queryClient);
  }};
  patchConfigQueries();
  if (expectedModels.length === 0) {{
    clearModelQueryPatch();
    // Inactive picker queries retain injected Provider data after invalidation, so reset their
    // cached data before returning to the official catalog.
    if (typeof queryClient.resetQueries === "function") {{
      await queryClient.resetQueries({{ predicate: matchesModelsQuery }}, {{ cancelRefetch: true }});
    }} else {{
      await queryClient.invalidateQueries({{
        predicate: matchesModelsQuery,
        refetchType: "all",
      }});
    }}
    await queryClient.invalidateQueries({{
      predicate: matchesConfigQuery,
      refetchType: "active",
    }});
    patchConfigQueries();
    const currentQueries = queryClient.getQueryCache().getAll().filter(matchesModelsQuery);
    return {{
      refreshed: currentQueries.length > 0,
      reason: currentQueries.length > 0 ? "official-model-queries-reset" : "models-query-not-found",
      injected: false,
      count: 0,
    }};
  }}
  await queryClient.invalidateQueries({{
    predicate: query => matchesModelsQuery(query) || matchesConfigQuery(query),
    refetchType: "active",
  }});
  patchConfigQueries();

  const currentQueries = queryClient.getQueryCache().getAll().filter(matchesModelsQuery);
  const expected = new Set(expectedModels);
  const injectedModels = expectedModels.map((model, index) => ({{
    id: model,
    model,
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName: model === "codex switch control" ? "Codex Switch Control" : model,
    description: model,
    modelSpecialty: null,
    hidden: false,
    supportedReasoningEfforts: supportedReasoningEffortsByModel[model] ?? [],
    defaultReasoningEffort: "high",
    inputModalities: imageInputModels.has(model) ? ["text", "image"] : ["text"],
    supportsPersonality: false,
    multiAgentVersion: null,
    additionalSpeedTiers: fastModeModels.has(model) ? ["fast"] : [],
    serviceTiers: fastModeModels.has(model)
      ? [{{ id: "priority", name: "Fast", description: "Faster responses with increased usage" }}]
      : [],
    defaultServiceTier: fastModeModels.has(model) ? "default" : null,
    isDefault: model === selectedModel || (!expected.has(selectedModel) && index === 0),
  }}));
  const previousPatchState = window[patchStateKey];
  if (previousPatchState?.queryClient && previousPatchState.queryClient !== queryClient) {{
    clearModelQueryPatch();
  }}
  const patchState = window[patchStateKey] ?? {{
    active: true,
    models: [],
    queries: new Set(),
    queryClient,
    unsubscribe: null,
  }};
  patchState.active = true;
  patchState.models = injectedModels;
  patchState.queryClient = queryClient;
  window[patchStateKey] = patchState;
  if (!patchState.unsubscribe) {{
    patchState.unsubscribe = queryClient.getQueryCache().subscribe(event => {{
      if (event?.type === "added") patchQuery(event.query);
    }});
  }}
  for (const query of currentQueries) patchQuery(query);
  const targetQueryKeys = currentQueries.length > 0
    ? currentQueries.map(query => query.queryKey)
    : [{fallback_query_key}];
  let injected = false;
  for (const queryKey of targetQueryKeys) {{
    queryClient.setQueryData(queryKey, current => {{
      const currentModels = Array.isArray(current?.data) ? current.data : [];
      const currentIds = currentModels.map(model => model?.model ?? model?.id).filter(Boolean);
      const matches = expectedModels.length === currentIds.length &&
        currentIds.every(model => expected.has(model));
      if (!matches) injected = true;
      const data = matches
        ? currentModels.map((model, index) => ({{
            ...model,
            additionalSpeedTiers: fastModeModels.has(model.model ?? model.id) ? ["fast"] : [],
            serviceTiers: fastModeModels.has(model.model ?? model.id)
              ? [{{ id: "priority", name: "Fast", description: "Faster responses with increased usage" }}]
              : [],
            defaultServiceTier: fastModeModels.has(model.model ?? model.id) ? "default" : null,
            inputModalities: imageInputModels.has(model.model ?? model.id)
              ? ["text", "image"]
              : ["text"],
            displayName: (model.model ?? model.id) === "codex switch control"
              ? "Codex Switch Control"
              : model.displayName,
            isDefault: (model.model ?? model.id) === selectedModel ||
              (!expected.has(selectedModel) && index === 0),
          }}))
        : injectedModels;
      return {{
        ...(current && typeof current === "object" ? current : {{}}),
        data,
        nextCursor: null,
      }};
    }});
  }}
  for (const query of queryClient.getQueryCache().getAll().filter(matchesModelsQuery)) {{
    patchQuery(query);
  }}
  const patchedObservers = [...patchState.queries]
    .flatMap(query => query.observers ?? [])
    .filter(observer => Boolean(observer[observerPatchSymbol])).length;
  return {{
    refreshed: true,
    reason: currentQueries.length > 0
      ? "existing-model-queries-refreshed"
      : "no-auth-model-query-created",
    queryKeys: targetQueryKeys,
    injected,
    count: injectedModels.length,
    patchedObservers,
  }};
}})()"#
    ))
}
