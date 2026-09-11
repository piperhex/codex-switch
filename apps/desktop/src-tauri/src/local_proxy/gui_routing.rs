use super::*;
use crate::codex_gui::account_selection::{self, GuiAccountSelection};

const GUI_PREFIX: &str = "/codex-gui";

pub(super) fn upstream_path(url: &str) -> Option<&str> {
    url.strip_prefix(GUI_PREFIX)
        .filter(|path| path.starts_with('/'))
}

pub(super) struct GuiProxyRequest<'a, R: Runtime> {
    pub app: &'a tauri::AppHandle<R>,
    pub method: &'a Method,
    pub url: &'a str,
    pub headers: &'a [(String, String)],
    pub body: Vec<u8>,
    pub session_id: Option<&'a str>,
    pub session_request_id: Option<u64>,
}

pub(super) fn selected_target<R: Runtime>(
    app: &tauri::AppHandle<R>,
    selection: &GuiAccountSelection,
) -> Result<ActiveTarget, String> {
    match selection {
        GuiAccountSelection::Account(_) => Ok(ActiveTarget::Official {
            model: providers::official_model(),
        }),
        GuiAccountSelection::Provider(id) => {
            let provider = providers::read_provider(&resolve_paths(app)?, id)?;
            providers::ensure_not_local_proxy_base_url(&provider.base_url)?;
            Ok(ActiveTarget::Provider(Box::new(provider)))
        }
        GuiAccountSelection::None => Err("请先选择 Codex GUI 账户。".to_string()),
    }
}

/// GUI requests and retries use only GUI switching rules. Shared fallback and concurrent
/// routing cannot replace the target, even when both workspaces select the same account.
pub(super) fn handle<R: Runtime>(
    request: GuiProxyRequest<'_, R>,
) -> Result<UpstreamPayload, String> {
    handle_selected(request).map_err(|_| "Codex GUI 请求未完成，请检查所选账户后重试。".to_string())
}

fn handle_selected<R: Runtime>(request: GuiProxyRequest<'_, R>) -> Result<UpstreamPayload, String> {
    if is_anthropic_messages_endpoint(request_path(request.url)) {
        return Err("Codex GUI only supports Codex requests".to_string());
    }
    if *request.method == Method::Get
        && matches!(request_path(request.url), "/models" | "/v1/models")
    {
        let selection = account_selection::read(request.app).map_err(|error| error.to_string())?;
        let target = selected_target(request.app, &selection)?;
        let account_id = match &selection {
            GuiAccountSelection::Account(id) => Some(id.as_str()),
            _ => None,
        };
        return models(&request, &target, account_id);
    }
    super::gui_forwarding::forward(request)
}

fn models<R: Runtime>(
    request: &GuiProxyRequest<'_, R>,
    target: &ActiveTarget,
    account_id: Option<&str>,
) -> Result<UpstreamPayload, String> {
    if let ActiveTarget::Provider(provider) = target {
        if !providers::uses_upstream_official_models(provider) {
            return Ok(provider_models_payload_with_image_route(provider, false));
        }
    }
    let payload = forward_active_request(ActiveForwardRequest {
        app: request.app,
        method: request.method,
        url: request.url,
        headers: &unconditional_model_catalog_headers(request.headers),
        body: Vec::new(),
        target,
        session_id: None,
        account_id_override: account_id,
    })?;
    if account_id.is_none() {
        return Ok(payload);
    }
    let settings = read_app_settings(request.app)?;
    override_official_model_context_windows(
        payload,
        settings.gpt_5_6_sol_context_window,
        &settings.official_model_context_windows,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scopes_only_gui_urls_and_preserves_queries() {
        assert_eq!(
            upstream_path("/codex-gui/v1/models?client_version=1"),
            Some("/v1/models?client_version=1")
        );
        assert_eq!(request_path("/codex-gui/v1/responses?x=1"), "/v1/responses");
        assert_eq!(upstream_path("/v1/responses"), None);
        assert_eq!(upstream_path("/codex-gui-other/v1/responses"), None);
    }
}
