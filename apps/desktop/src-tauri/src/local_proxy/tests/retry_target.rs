#[test]
fn quota_fallback_retry_re_resolves_provider_and_usage_target() {
    let mut target = ActiveTarget::Official {
        model: "official-model".to_string(),
    };
    let refresh_target = std::cell::Cell::new(false);
    let mut forwarded_routes = Vec::new();
    let response = retry_upstream_request_with(
        Duration::ZERO,
        || {
            refresh_retry_target(&mut target, &refresh_target, || {
                Ok(ActiveTarget::Provider(Box::new(openai_provider(
                    "https://provider.example/v1".to_string(),
                ))))
            })?;
            forwarded_routes.push(proxy_diagnostic_route("/v1/responses", &target).as_str());
            match target {
                ActiveTarget::Official { .. } => Ok(official_payload(429, 0)),
                ActiveTarget::Provider(_) => {
                    Ok(json_payload(200, json!({ "id": "provider-response" })))
                }
                _ => panic!("unexpected retry target"),
            }
        },
        |_, event| {
            assert!(matches!(event, UpstreamQuotaEvent::Retry { .. }));
            refresh_target.set(true);
            true
        },
        |_| panic!("quota fallback should retry immediately"),
    )
    .unwrap();

    assert_eq!(response.status, 200);
    assert_eq!(
        forwarded_routes,
        ["official", "provider_responses_passthrough"]
    );
    let (provider_name, provider_id, _) = token_usage_target(&target, None).unwrap();
    assert_eq!(provider_name, "OpenAI");
    assert_eq!(provider_id.as_deref(), Some("openai"));
}

#[test]
fn retry_keeps_the_selected_image_target_without_an_automatic_switch() {
    let mut target = ActiveTarget::Official {
        model: "image-model".to_string(),
    };
    let refresh_target = std::cell::Cell::new(false);
    assert!(!refresh_retry_target(&mut target, &refresh_target, || {
        panic!("an image pool retry must keep its selected route")
    })
    .unwrap());
    assert!(matches!(target, ActiveTarget::Official { model } if model == "image-model"));
}

#[test]
fn failed_retry_target_resolution_does_not_clear_the_pending_switch() {
    let mut target = ActiveTarget::Official {
        model: "official-model".to_string(),
    };
    let refresh_target = std::cell::Cell::new(true);
    let error = refresh_retry_target(&mut target, &refresh_target, || {
        Err("fallback Provider is unavailable".to_string())
    })
    .unwrap_err();
    assert_eq!(error, "fallback Provider is unavailable");
    assert!(refresh_target.get());
}
