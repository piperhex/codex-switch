    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use serde_json::json;
    use tiny_http::{Header, Response, Server};

    const STALE_OFFICIAL_CONFIG: &str = r#"model = "gpt-5.5"

[features]
js_repl = true

[shell_environment_policy.set]
BROWSER_USE_AVAILABLE_BACKENDS = "iab"
NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S = "old-hash"
NODE_REPL_TRUSTED_CODE_PATHS = 'C:\old'

[windows]
sandbox = "workspace-write"

[model_providers.custom]
base_url = "https://custom.example.com/v1"
"#;

    fn provider() -> ProviderProfile {
        ProviderProfile {
            id: "p".to_string(),
            kind: ProviderKind::Custom,
            name: "Gateway".to_string(),
            group: String::new(),
            base_url: "https://gateway.example.com/v1".to_string(),
            api_key: "sk-test".to_string(),
            model: "gpt-4.1".to_string(),
            models: vec!["gpt-4.1".to_string()],
            model_reasoning_efforts: ModelReasoningEfforts::new(),
            model_context_windows: ModelContextWindows::new(),
            model_api_formats: ModelApiFormats::new(),
            image_input_models: Vec::new(),
            image_input_models_configured: false,
            context_window: None,
            model_selection_controlled_by_codex: false,
            api_format: ProviderApiFormat::OpenaiResponses,
            balance_platform: None,
            balance_query_url: None,
            balance_query_token: None,
            wallet_query_url: None,
            wallet_query_token: None,
            wallet_username: None,
            wallet_password: None,
        }
    }
