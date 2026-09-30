#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asset_paths_default_to_the_index_and_strip_queries() {
        assert_eq!(asset_path("/"), Some("index.html".to_string()));
        assert_eq!(
            asset_path("/assets/index.js?v=1"),
            Some("assets/index.js".to_string())
        );
    }

    #[test]
    fn asset_paths_reject_traversal_and_backslashes() {
        assert_eq!(asset_path("/../settings.json"), None);
        assert_eq!(asset_path("/assets\\index.js"), None);
        assert_eq!(asset_path("/assets//index.js"), None);
    }

    #[test]
    fn port_zero_is_invalid_and_the_default_is_disabled() {
        assert!(validate_port(0).is_err());
        assert!(validate_port(1).is_ok());
        assert!(AppSettings::default().web_proxy_port.is_none());
        assert!(!AppSettings::default().web_proxy_listen_on_all_interfaces);
    }

    #[test]
    fn web_server_configuration_changes_when_lan_listening_changes() {
        let loopback = WebServerConfiguration {
            port: 18_080,
            listen_on_all_interfaces: false,
            lan_api_key: None,
        };
        let lan = WebServerConfiguration {
            listen_on_all_interfaces: true,
            ..loopback.clone()
        };

        assert!(loopback != lan);
        assert_eq!(web_server_host(false), "127.0.0.1");
        assert_eq!(web_server_host(true), "0.0.0.0");
    }

    #[test]
    fn hosted_index_includes_the_runtime_marker_once() {
        let source = b"<!doctype html><html><head></head><body></body></html>";
        let injected = inject_hosted_runtime_marker(source);
        let injected_again = inject_hosted_runtime_marker(&injected);
        let html = String::from_utf8(injected_again).unwrap();

        assert_eq!(html.matches(HOSTED_RUNTIME_MARKER).count(), 1);
    }

    fn remote_request() -> tiny_http::TestRequest {
        tiny_http::TestRequest::new()
            .with_remote_addr("192.168.1.10:54321".parse().unwrap())
            .with_method(Method::Post)
            .with_header(header("Host", "192.168.1.20:18080"))
            .with_header(header("Origin", "http://192.168.1.20:18080"))
    }

    #[test]
    fn authenticated_remote_requests_can_administer_the_host() {
        let security = WebRequestSecurity { lan_api_key: Some(Arc::from("test-key")) };
        for body in [
            r#"{"command":"save_provider"}"#,
            r#"{"command":"set_local_proxy_listen_on_all_interfaces"}"#,
            r#"{"command":"delete_account"}"#,
            r#"{"command":"codex_gui_scheduled_tasks"}"#,
        ] {
            let request = remote_request().with_body(body)
                .with_header(header("X-API-Key", "test-key")).into();
            assert_eq!(security.authorize(&request), Ok(()));
        }
        let bearer = remote_request()
            .with_header(header("Authorization", "Bearer test-key")).into();
        assert_eq!(security.authorize(&bearer), Ok(()));
    }

    #[test]
    fn remote_administration_still_requires_a_valid_key_and_matching_origin() {
        let security = WebRequestSecurity { lan_api_key: Some(Arc::from("test-key")) };
        assert_eq!(security.authorize(&remote_request().into()), Err(StatusCode(401)));
        let wrong = remote_request().with_header(header("X-API-Key", "wrong-key")).into();
        assert_eq!(security.authorize(&wrong), Err(StatusCode(401)));
        let foreign = tiny_http::TestRequest::new()
            .with_remote_addr("192.168.1.10:54321".parse().unwrap())
            .with_header(header("Host", "192.168.1.20:18080"))
            .with_header(header("Origin", "http://attacker.invalid"))
            .with_header(header("X-API-Key", "test-key")).into();
        assert_eq!(security.authorize(&foreign), Err(StatusCode(403)));
        let no_key = WebRequestSecurity { lan_api_key: None };
        assert_eq!(no_key.authorize(&remote_request().into()), Err(StatusCode(401)));
        assert!(security.authorize(&tiny_http::TestRequest::new().into()).is_ok());
    }

    #[test]
    fn lan_api_keys_are_random_and_constant_time_comparison_rejects_variants() {
        let first = generate_web_lan_api_key();
        let second = generate_web_lan_api_key();
        assert!(first.starts_with(WEB_LAN_API_KEY_PREFIX));
        assert_eq!(first.len(), WEB_LAN_API_KEY_PREFIX.len() + 43);
        assert_ne!(first, second);
        assert!(constant_time_equal(&first, &first));
        assert!(!constant_time_equal(&first, &second));
        assert!(!constant_time_equal(&first, &first[..first.len() - 1]));
    }

    #[test]
    fn non_loopback_origins_must_match_the_listener_host() {
        assert!(same_origin_values(
            Some("http://192.168.1.20:18765"),
            Some("192.168.1.20:18765"),
        ));
        assert!(same_origin_values(None, Some("192.168.1.20:18765")));
        assert!(!same_origin_values(
            Some("http://attacker.invalid:18765"),
            Some("192.168.1.20:18765"),
        ));
        assert!(!same_origin_values(
            Some("https://192.168.1.20:18765"),
            Some("192.168.1.20:18765"),
        ));
    }

    #[test]
    fn sandboxed_previews_cannot_invoke_commands_even_on_loopback() {
        let security = WebRequestSecurity { lan_api_key: None };
        for origin in ["null", "http://attacker.invalid"] {
            let request = tiny_http::TestRequest::new()
                .with_remote_addr("127.0.0.1:54321".parse().unwrap())
                .with_header(header("Host", "127.0.0.1:18080"))
                .with_header(header("Origin", origin)).into();
            assert_eq!(security.authorize(&request), Err(StatusCode(403)));
        }
        let request = tiny_http::TestRequest::new()
            .with_remote_addr("127.0.0.1:54321".parse().unwrap())
            .with_header(header("Host", "127.0.0.1:18080"))
            .with_header(header("Origin", "http://127.0.0.1:18080")).into();
        assert_eq!(security.authorize(&request), Ok(()));
    }
}
