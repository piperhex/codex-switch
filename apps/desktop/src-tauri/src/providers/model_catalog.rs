fn model_catalog_for_models(models: &[String], options: ModelCatalogOptions<'_>) -> Value {
    let entries = models
        .iter()
        .enumerate()
        .map(|(index, model)| {
            let model_reasoning_profile =
                reasoning_effort_profile_for_model(model, options.reasoning_profile);
            let reasoning_levels = supported_reasoning_levels_for_model(
                model,
                model_reasoning_profile,
                options.reasoning_efforts,
            );
            let model_context_window =
                options
                    .context_windows
                    .get(model)
                    .copied()
                    .unwrap_or_else(|| {
                        default_context_window_for_model(model, options.default_context_window)
                    });
            provider_model_catalog_entry(
                model,
                index,
                model_context_window,
                reasoning_levels,
                options.image_input_models.contains(model),
            )
        })
        .collect::<Vec<_>>();
    json!({ "models": entries })
}

pub(crate) fn supported_reasoning_levels(profile: ReasoningEffortProfile) -> Value {
    let levels = match profile {
        ReasoningEffortProfile::Standard => vec![
            json!({ "effort": "none", "description": "Disable Thinking" }),
            json!({ "effort": "high", "description": "Enabled Thinking" }),
        ],
        ReasoningEffortProfile::OpenAi => openai_reasoning_levels(false, false),
        ReasoningEffortProfile::OpenAiMax => openai_reasoning_levels(true, false),
        ReasoningEffortProfile::OpenAiUltra => openai_reasoning_levels(true, true),
        ReasoningEffortProfile::DeepSeek => vec![
            json!({ "effort": "none", "description": "Disable Thinking" }),
            json!({ "effort": "low", "description": "Low Thinking" }),
            json!({ "effort": "medium", "description": "Standard Thinking" }),
            json!({ "effort": "high", "description": "High Thinking" }),
            json!({ "effort": "xhigh", "description": "Extended Thinking" }),
            json!({ "effort": "max", "description": "Maximum Thinking" }),
        ],
    };
    Value::Array(levels)
}

pub(crate) fn supported_reasoning_levels_for_model(
    model: &str,
    fallback: ReasoningEffortProfile,
    configured: &ModelReasoningEfforts,
) -> Value {
    configured.get(model).map_or_else(
        || supported_reasoning_levels(fallback),
        |efforts| Value::Array(efforts.iter().map(reasoning_level).collect()),
    )
}

fn reasoning_level(effort: &ReasoningEffort) -> Value {
    let (effort, description) = match effort {
        ReasoningEffort::None => ("none", "Disable thinking"),
        ReasoningEffort::Low => ("low", "Fast responses with lighter reasoning"),
        ReasoningEffort::Medium => (
            "medium",
            "Balances speed and reasoning depth for everyday tasks",
        ),
        ReasoningEffort::High => ("high", "Greater reasoning depth for complex problems"),
        ReasoningEffort::Xhigh => ("xhigh", "Extra high reasoning depth for complex problems"),
        ReasoningEffort::Max => ("max", "Maximum reasoning depth for the hardest problems"),
        ReasoningEffort::Ultra => ("ultra", "Maximum reasoning with automatic task delegation"),
    };
    json!({ "effort": effort, "description": description })
}

fn openai_reasoning_levels(include_max: bool, include_ultra: bool) -> Vec<Value> {
    let mut levels = vec![
        json!({ "effort": "low", "description": "Fast responses with lighter reasoning" }),
        json!({
            "effort": "medium",
            "description": "Balances speed and reasoning depth for everyday tasks"
        }),
        json!({ "effort": "high", "description": "Greater reasoning depth for complex problems" }),
        json!({
            "effort": "xhigh",
            "description": "Extra high reasoning depth for complex problems"
        }),
    ];
    if include_max {
        levels.push(json!({
            "effort": "max",
            "description": "Maximum reasoning depth for the hardest problems"
        }));
    }
    if include_ultra {
        levels.push(json!({
            "effort": "ultra",
            "description": "Maximum reasoning with automatic task delegation"
        }));
    }
    levels
}

fn provider_model_catalog_entry(
    model: &str,
    index: usize,
    context_window: u64,
    reasoning_levels: Value,
    supports_image_input: bool,
) -> Value {
    let input_modalities = if supports_image_input {
        json!(["text", "image"])
    } else {
        json!(["text"])
    };
    json!({
        "slug": model,
        "display_name": model,
        "description": model,
        "base_instructions": concat!(
            "You are Codex, a coding agent. You and the user share the same workspace ",
            "and collaborate to achieve the user's goals."
        ),
        "default_reasoning_level": "high",
        "supported_reasoning_levels": reasoning_levels,
        "shell_type": "shell_command",
        "visibility": "list",
        "supported_in_api": true,
        "priority": 1000 + index,
        "supports_reasoning_summaries": true,
        "default_reasoning_summary": "none",
        "support_verbosity": false,
        "default_verbosity": null,
        "apply_patch_tool_type": null,
        "web_search_tool_type": "text",
        "truncation_policy": { "mode": "bytes", "limit": 10000 },
        "supports_parallel_tool_calls": false,
        "supports_image_detail_original": false,
        "context_window": context_window,
        "max_context_window": context_window,
        "auto_compact_token_limit": null,
        "comp_hash": null,
        "effective_context_window_percent": 95,
        "experimental_supported_tools": [],
        "input_modalities": input_modalities,
        "supports_search_tool": false,
        "use_responses_lite": false,
        "auto_review_model_override": null,
        "tool_mode": null,
        "multi_agent_version": null,
        "additional_speed_tiers": [],
        "service_tiers": [],
        "default_service_tier": null,
        "availability_nux": null,
        "upgrade": null
    })
}

fn write_provider_model_catalog(paths: &Paths, provider: &ProviderProfile) -> Result<(), String> {
    let catalog =
        model_catalog_for_provider_with_image_route(provider, image_input_route_enabled(paths));
    write_json_if_changed(&paths.codex_home.join(MODEL_CATALOG_FILENAME), &catalog).map(|_| ())
}

#[cfg(test)]
pub(crate) fn model_catalog_for_provider(provider: &ProviderProfile) -> Value {
    model_catalog_for_provider_with_image_route(provider, false)
}

pub(crate) fn model_catalog_for_provider_with_image_route(
    provider: &ProviderProfile,
    image_input_route_enabled: bool,
) -> Value {
    let models = codex_visible_models(provider);
    let image_input_models = routed_image_input_models(
        &models,
        &codex_image_input_models(provider),
        image_input_route_enabled,
    );
    let reasoning_efforts = codex_model_reasoning_efforts(provider);
    let context_windows = codex_model_context_windows(provider);
    model_catalog_for_models(
        &models,
        ModelCatalogOptions {
            image_input_models: &image_input_models,
            reasoning_efforts: &reasoning_efforts,
            context_windows: &context_windows,
            default_context_window: provider_context_window(provider),
            reasoning_profile: reasoning_effort_profile(provider),
        },
    )
}

#[cfg(test)]
pub(crate) fn model_catalog_for_provider_group(providers: &[ProviderProfile]) -> Value {
    model_catalog_for_provider_group_with_image_route(providers, false)
}

pub(crate) fn model_catalog_for_provider_group_with_image_route(
    providers: &[ProviderProfile],
    image_input_route_enabled: bool,
) -> Value {
    let mut data = provider_group_catalog_data(providers);
    data.image_input_models = routed_image_input_models(
        &data.models,
        &data.image_input_models,
        image_input_route_enabled,
    );
    model_catalog_for_models(
        &data.models,
        ModelCatalogOptions {
            image_input_models: &data.image_input_models,
            reasoning_efforts: &data.reasoning_efforts,
            context_windows: &data.context_windows,
            default_context_window: DEFAULT_MODEL_CONTEXT_WINDOW,
            reasoning_profile: ReasoningEffortProfile::Standard,
        },
    )
}

fn write_local_proxy_config(
    paths: &Paths,
    name: &str,
    model: Option<&str>,
    include_model_catalog: bool,
) -> Result<(), String> {
    let existing = if paths.current_config.exists() {
        fs::read_to_string(&paths.current_config)
            .map_err(|error| format!("Failed to read Codex config: {error}"))?
    } else {
        String::new()
    };
    let requires_openai_auth = read_state(paths)
        .local_proxy_openai_auth_account_id
        .is_some();
    let token_command = std::env::current_exe()
        .map_err(|error| format!("Failed to locate Codex Switch for local proxy auth: {error}"))?
        .display()
        .to_string();
    let options = LocalProxyConfigOptions {
        name,
        model,
        include_model_catalog,
        requires_openai_auth,
        token_command: &token_command,
    };
    let merged = merge_local_proxy_config(&existing, &options)?;
    write_text_if_changed(&paths.current_config, &merged).map(|_| ())
}

struct LocalProxyConfigOptions<'a> {
    name: &'a str,
    model: Option<&'a str>,
    include_model_catalog: bool,
    requires_openai_auth: bool,
    token_command: &'a str,
}

fn merge_local_proxy_config(
    existing: &str,
    options: &LocalProxyConfigOptions<'_>,
) -> Result<String, String> {
    codex_config::apply_local_proxy(
        existing,
        &LocalProxyConfig {
            name: options.name,
            model: options.model,
            model_catalog_filename: options
                .include_model_catalog
                .then_some(MODEL_CATALOG_FILENAME),
            requires_openai_auth: options.requires_openai_auth,
            token_command: options.token_command,
        },
    )
    .map_err(|error| error.to_string())
}

fn config_contains_local_proxy(config: &str) -> bool {
    codex_config::contains_local_proxy(config)
}

pub(crate) fn official_model() -> String {
    DEFAULT_OFFICIAL_MODEL.to_string()
}
