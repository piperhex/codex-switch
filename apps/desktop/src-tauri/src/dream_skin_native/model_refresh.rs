#[cfg(test)]
const CODEX_MODEL_QUERY_PREFIX: [&str; 2] = ["models", "list"];
use crate::providers::LOCAL_PROXY_PORT;
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

const CODEX_SPEED_SELECTOR_OVERLAY: &str = r#"
  (() => {
    const stateKey = "__CODEX_SWITCH_SPEED_SELECTOR__";
    const overlayVersion = 3;
    const endpoint = "http://127.0.0.1:__CODEX_SWITCH_PROXY_PORT__/codex-switch/service-tier";
    const token = "CODEX_SWITCH_LOCAL_PROXY";
    const existing = window[stateKey];
    const removeSelectors = () => {
      existing?.cleanup?.();
      existing?.observer?.disconnect();
      if (existing?.timer) clearInterval(existing.timer);
      const injectedNodes = "[data-codex-switch-speed-selector], [data-codex-switch-speed-submenu]";
      for (const selector of document.querySelectorAll(injectedNodes)) {
        selector.remove();
      }
      delete window[stateKey];
    };
    if (window.__CODEX_SWITCH_SPEED_SELECTOR_ALLOWED__ !== true) {
      removeSelectors();
      return;
    }
    if (existing?.installed && existing.version === overlayVersion) {
      fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } })
        .then(response => response.ok ? response.json() : null)
        .then(result => {
          if (result?.service_tier !== "priority" && result?.service_tier !== "default") return;
          existing.tier = result.service_tier;
          for (const selector of document.querySelectorAll("[data-codex-switch-speed-selector]")) {
            const value = selector.querySelector("[data-speed-value]");
            if (value) value.textContent = existing.tier === "priority" ? "Fast" : "普通";
          }
        }).catch(() => {});
      return;
    }
    removeSelectors();
    const state = {
      installed: true, version: overlayVersion, tier: "default", observer: null, timer: null,
      submenu: null, trigger: null, refreshing: false,
    };
    window[stateKey] = state;
    const callApi = async (method, body) => {
      const response = await fetch(endpoint, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) throw new Error(`service-tier API returned ${response.status}`);
      return response.json();
    };
    const closeSubmenu = () => {
      state.submenu?.remove();
      state.submenu = null;
      state.trigger?.setAttribute("aria-expanded", "false");
      state.trigger = null;
    };
    const syncOptions = () => {
      for (const option of state.submenu?.querySelectorAll("[data-service-tier]") ?? []) {
        const selected = option.dataset.serviceTier === state.tier;
        option.setAttribute("aria-checked", String(selected));
        option.style.background = selected ? "var(--background-primary-ghost)" : "transparent";
        option.querySelector("[data-speed-check]")?.style.setProperty(
          "visibility", selected ? "visible" : "hidden",
        );
      }
    };
    const selectTier = async (option, tier) => {
      try {
        await callApi("POST", { service_tier: tier });
        state.tier = tier;
        const selector = state.trigger;
        if (selector) selector.querySelector("[data-speed-value]").textContent = tier === "priority" ? "Fast" : "普通";
        syncOptions();
        closeSubmenu();
      } catch (error) {
        console.warn("Codex Switch speed selection failed", error);
      }
    };
    const createOption = (label, tier) => {
      const option = document.createElement("button");
      option.type = "button";
      option.dataset.serviceTier = tier;
      option.setAttribute("role", "menuitemradio");
      option.style.cssText = "display:flex;width:100%;justify-content:space-between;border:0;border-radius:8px;"
        + "padding:6px 8px;font-size:14px;line-height:20px;text-align:start;"
        + "cursor:pointer;color:var(--text-primary);background:transparent;";
      const optionLabel = document.createElement("span");
      const check = document.createElement("span");
      optionLabel.textContent = label;
      check.dataset.speedCheck = "true";
      check.textContent = "✓";
      check.style.visibility = "hidden";
      option.append(optionLabel, check);
      option.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        selectTier(option, tier);
      });
      return option;
    };
    const findReasoningItem = () => {
      const menu = [...document.querySelectorAll('[role="menu"][data-state="open"]')]
        .find(element => element.querySelector("[data-model-picker-view-toggle]"));
      const activePanel = menu?.querySelector('[data-active="true"]');
      const submenuItems = [...activePanel?.querySelectorAll('[role="menuitem"][aria-haspopup="menu"]') ?? []];
      return submenuItems.length >= 2 ? submenuItems.at(-1) : null;
    };
    const openSubmenu = (container, isChinese) => {
      closeSubmenu();
      const submenu = document.createElement("div");
      const rect = container.getBoundingClientRect();
      submenu.dataset.codexSwitchSpeedSubmenu = "true";
      submenu.setAttribute("role", "menu");
      submenu.className = "no-drag z-50 m-px flex select-none flex-col overflow-y-auto px-1 py-1 "
        + "bg-surface-elevated-secondary/90 text-default ring-border rounded-xl ring-[0.5px] "
        + "shadow-xl-spread backdrop-blur-sm";
      submenu.style.cssText = "position:fixed;z-index:60;min-width:224px;";
      submenu.append(
        createOption(isChinese ? "普通" : "Standard", "default"),
        createOption("Fast", "priority"),
      );
      document.body.append(submenu);
      const width = submenu.getBoundingClientRect().width;
      const height = submenu.getBoundingClientRect().height;
      submenu.style.left = `${Math.max(8, rect.left - width - 4)}px`;
      submenu.style.top = `${Math.max(8, Math.min(rect.top, innerHeight - height - 8))}px`;
      state.submenu = submenu;
      state.trigger = container;
      container.setAttribute("aria-expanded", "true");
      syncOptions();
    };
    const createSelector = reasoningItem => {
      const isChinese = document.documentElement.lang.toLowerCase().startsWith("zh");
      const container = document.createElement("div");
      const content = document.createElement("div");
      const label = document.createElement("span");
      const value = document.createElement("span");
      const arrow = document.createElement("span");
      container.dataset.codexSwitchSpeedSelector = "true";
      container.className = reasoningItem.className;
      container.setAttribute("role", "menuitem");
      container.setAttribute("aria-haspopup", "menu");
      container.setAttribute("aria-expanded", "false");
      container.setAttribute("aria-label", isChinese ? "速度" : "Speed");
      content.className = "flex w-full min-w-0 items-center gap-3";
      label.textContent = isChinese ? "速度" : "Speed";
      value.dataset.speedValue = "true";
      value.className = "min-w-0 truncate text-tertiary";
      value.textContent = isChinese ? "普通" : "Standard";
      const valueWrap = document.createElement("span");
      valueWrap.className = "flex min-w-0 flex-1 justify-end text-tertiary";
      valueWrap.append(value);
      arrow.textContent = "›";
      arrow.className = "shrink-0 text-xl leading-none text-tertiary";
      content.append(label, valueWrap, arrow);
      container.append(content);
      container.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        if (state.trigger === container) closeSubmenu();
        else openSubmenu(container, isChinese);
      });
      return container;
    };
    const fitMenuToSelector = (reasoningItem, container) => {
      const advancedView = reasoningItem.parentElement;
      const menuRoot = advancedView?.closest("[data-view]");
      if (!advancedView || !menuRoot || menuRoot.dataset.view !== "advanced") return;
      menuRoot.style.setProperty("--advanced-view-height", `${advancedView.scrollHeight}px`);
      menuRoot.style.height = "calc(var(--simple-view-height) + var(--advanced-view-height))";
    };
    const render = () => {
      if (window.__CODEX_SWITCH_SPEED_SELECTOR_ALLOWED__ !== true) {
        closeSubmenu();
        for (const selector of document.querySelectorAll("[data-codex-switch-speed-selector]")) selector.remove();
        return;
      }
      const reasoningItem = findReasoningItem();
      if (!reasoningItem) {
        closeSubmenu();
        return;
      }
      const advancedView = reasoningItem.parentElement;
      let container = advancedView.querySelector("[data-codex-switch-speed-selector]");
      if (!container) {
        container = createSelector(reasoningItem);
        reasoningItem.after(container);
      }
      fitMenuToSelector(reasoningItem, container);
    };
    state.observer = new MutationObserver(render);
    state.cleanup = () => document.removeEventListener("pointerdown", state.pointerListener, true);
    state.pointerListener = event => {
      if (!state.trigger?.contains(event.target) && !state.submenu?.contains(event.target)) closeSubmenu();
    };
    document.addEventListener("pointerdown", state.pointerListener, true);
    state.observer.observe(document.documentElement, { childList: true, subtree: true });
    state.timer = setInterval(async () => {
      if (state.refreshing) return;
      state.refreshing = true;
      try {
        const result = await callApi("GET");
        if (result?.service_tier !== "priority" && result?.service_tier !== "default") return;
        state.tier = result.service_tier;
        render();
      } catch {
        window.__CODEX_SWITCH_SPEED_SELECTOR_ALLOWED__ = false;
        render();
      } finally {
        state.refreshing = false;
      }
    }, 1000);
    render();
    callApi("GET").then(result => {
      if (result?.service_tier === "priority" || result?.service_tier === "default") {
        state.tier = result.service_tier;
        for (const selector of document.querySelectorAll("[data-codex-switch-speed-selector]")) {
          const value = selector.querySelector("[data-speed-value]");
          if (value) value.textContent = state.tier === "priority" ? "Fast" : "普通";
        }
        syncOptions();
      }
    }).catch(() => {});
  })();
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
    let speed_selector_overlay = CODEX_SPEED_SELECTOR_OVERLAY
        .replace("__CODEX_SWITCH_PROXY_PORT__", &LOCAL_PROXY_PORT.to_string());
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
  const hasNoAuthModelQuery = queryClient.getQueryCache().getAll().some(query => {{
    const key = query.queryKey;
    const active = typeof query.isActive === "function"
      ? query.isActive()
      : (query.observers?.length ?? 0) > 0;
    return active && matchesModelsQuery(query) && key[2] === "local" && key[3] === "no-auth";
  }});
  window.__CODEX_SWITCH_SPEED_SELECTOR_ALLOWED__ = expectedModels.length > 0 && hasNoAuthModelQuery;
{speed_selector_overlay}
{observer_patch_helpers}
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
