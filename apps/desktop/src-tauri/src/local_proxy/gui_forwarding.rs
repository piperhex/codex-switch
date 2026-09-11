use super::{
    gui_auto_switch::{self, Route},
    gui_routing::{selected_target, GuiProxyRequest},
    *,
};
use std::cell::RefCell;

struct Attempt {
    route: Route,
    target: ActiveTarget,
}

pub(super) fn forward<R: Runtime>(
    mut request: GuiProxyRequest<'_, R>,
) -> Result<UpstreamPayload, String> {
    let route = gui_auto_switch::prepare(request.app, request.session_id)
        .map_err(|error| error.to_string())?;
    let target = selected_target(request.app, &route.selection)?;
    let attempt = RefCell::new(Attempt { route, target });
    let started_at = Instant::now();
    request.body = inject_system_prompts(filter_system_prompts(request.body));
    let result = retry_upstream_request(
        upstream_429_retry_timeout(request.app)?,
        || {
            let mut attempt = attempt.borrow_mut();
            attempt.route.begin_attempt();
            context(&request, &attempt.target, started_at);
            send(&request, &attempt)
        },
        |_, event| advance(&request, &attempt, event),
    );
    let target = attempt.into_inner().target;
    let diagnostic = proxy_diagnostic_entry(
        request.method,
        request.url,
        request.headers,
        &request.body,
        Some(&target),
        proxy_diagnostic_route(request_path(request.url), &target),
    );
    // A fallback Provider must be attributed from the final GUI target, never the shared target.
    let result =
        attach_token_usage_capture(request.app, context(&request, &target, started_at), result);
    append_proxy_diagnostic_result(request.app, diagnostic, &result, started_at.elapsed());
    result
}

fn context<R: Runtime>(
    request: &GuiProxyRequest<'_, R>,
    target: &ActiveTarget,
    started_at: Instant,
) -> Option<TokenUsageContext> {
    let context = token_usage_context(TokenUsageRequest {
        method: request.method,
        path: request_path(request.url),
        body: &request.body,
        headers: request.headers,
        target,
        started_at,
        session_id: request.session_id,
        session_request_id: request.session_request_id,
    });
    if let Some(context) = &context {
        update_proxy_session_target(
            request.session_id,
            request.session_request_id,
            &context.provider,
            &context.model,
        );
    }
    context
}

fn advance<R: Runtime>(
    request: &GuiProxyRequest<'_, R>,
    attempt: &RefCell<Attempt>,
    event: UpstreamQuotaEvent,
) -> bool {
    let UpstreamQuotaEvent::Retry {
        exhausted_account_ids,
    } = event
    else {
        return false;
    };
    let next = gui_auto_switch::after_quota(
        request.app,
        &attempt.borrow().route,
        request.session_id,
        &exhausted_account_ids,
    );
    let route = match next {
        Ok(Some(route)) => route,
        Ok(None) => return false,
        Err(error) => {
            log_proxy_error!("GUI automatic account switch failed: {error}");
            return false;
        }
    };
    match selected_target(request.app, &route.selection) {
        Ok(target) => {
            attempt.replace(Attempt { route, target });
            true
        }
        Err(_) => false,
    }
}

fn send<R: Runtime>(
    request: &GuiProxyRequest<'_, R>,
    attempt: &Attempt,
) -> Result<UpstreamPayload, String> {
    let account_id = match &attempt.route.selection {
        crate::codex_gui::account_selection::GuiAccountSelection::Account(id) => Some(id.as_str()),
        _ => None,
    };
    let mut payload = forward_active_request(ActiveForwardRequest {
        app: request.app,
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: request.body.clone(),
        target: &attempt.target,
        session_id: request.session_id,
        account_id_override: account_id,
    })?;
    // The generic retry loop also serves the main proxy; GUI exclusions remain private.
    if let Some(account) = payload.token_usage_account.as_mut() {
        account.auto_switch_eligible = false;
        account.concurrent_request_started_at = None;
    }
    if let ActiveTarget::Provider(provider) = &attempt.target {
        if !providers::uses_upstream_official_models(provider) {
            payload
                .response_headers
                .retain(|(name, _)| !name.eq_ignore_ascii_case("x-models-etag"));
            payload.response_headers.push((
                "x-models-etag".into(),
                provider_models_etag_with_image_route(provider, false),
            ));
        }
    }
    Ok(payload)
}
