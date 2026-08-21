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
        };
        let lan = WebServerConfiguration {
            listen_on_all_interfaces: true,
            ..loopback
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
}
