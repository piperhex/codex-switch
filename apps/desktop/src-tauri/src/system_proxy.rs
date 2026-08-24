use std::sync::{OnceLock, RwLock};

use reqwest::{blocking::ClientBuilder, Proxy, Url};

use crate::models::NetworkProxySettings;

static NETWORK_PROXY: OnceLock<RwLock<Option<Url>>> = OnceLock::new();

#[derive(Clone, Debug, Default, PartialEq)]
struct SystemProxyConfig {
    default_proxy: Option<Url>,
    http_proxy: Option<Url>,
    https_proxy: Option<Url>,
    bypass: Vec<String>,
}

impl SystemProxyConfig {
    fn proxy_for(&self, target: &Url) -> Option<Url> {
        self.configured_proxy_for(target)
    }

    fn configured_proxy_for(&self, target: &Url) -> Option<Url> {
        if self.should_bypass(target) {
            return None;
        }

        match target.scheme() {
            "http" => self
                .http_proxy
                .as_ref()
                .or(self.default_proxy.as_ref())
                .cloned(),
            "https" => self
                .https_proxy
                .as_ref()
                .or(self.default_proxy.as_ref())
                .cloned(),
            _ => None,
        }
    }

    fn should_bypass(&self, target: &Url) -> bool {
        let Some(host) = target.host_str() else {
            return true;
        };
        let host = host.trim_matches(['[', ']']).to_ascii_lowercase();
        if host == "localhost"
            || host
                .parse::<std::net::IpAddr>()
                .is_ok_and(|address| address.is_loopback())
        {
            return true;
        }

        self.bypass
            .iter()
            .any(|rule| bypass_rule_matches(rule, &host, target.port_or_known_default()))
    }
}

pub(crate) fn apply(builder: ClientBuilder) -> ClientBuilder {
    if let Some(proxy_url) = configured_network_proxy() {
        return builder.no_proxy().proxy(Proxy::custom(move |target| {
            should_proxy_target(target).then(|| proxy_url.clone())
        }));
    }
    let Some(config) = current_system_proxy() else {
        return builder;
    };
    builder.proxy(Proxy::custom(move |target| config.proxy_for(target)))
}

pub(crate) fn configure(settings: &NetworkProxySettings) -> Result<(), String> {
    let proxy_url = network_proxy_url(settings)?;
    let mut configured = NETWORK_PROXY
        .get_or_init(|| RwLock::new(None))
        .write()
        .map_err(|_| "Network proxy settings are temporarily unavailable".to_string())?;
    *configured = proxy_url;
    Ok(())
}

pub(crate) fn normalize_settings(
    mut settings: NetworkProxySettings,
) -> Result<NetworkProxySettings, String> {
    settings.proxy_url = settings.proxy_url.trim().to_string();
    if !settings.enabled {
        return Ok(settings);
    }
    let normalized_url = parse_network_proxy_base_url(&settings.proxy_url)?;
    if settings.proxy_port.is_none_or(|port| port == 0) {
        return Err("Enter a proxy port between 1 and 65535".to_string());
    }
    settings.proxy_url = normalized_url;
    Ok(settings)
}

fn configured_network_proxy() -> Option<Url> {
    let settings = NETWORK_PROXY.get()?;
    match settings.read() {
        Ok(proxy_url) => proxy_url.clone(),
        Err(error) => {
            eprintln!("network proxy settings lock was poisoned; using the last saved value");
            error.into_inner().clone()
        }
    }
}

fn network_proxy_url(settings: &NetworkProxySettings) -> Result<Option<Url>, String> {
    if !settings.enabled {
        return Ok(None);
    }
    let normalized = normalize_settings(settings.clone())?;
    let mut url = Url::parse(&normalized.proxy_url)
        .map_err(|_| "Enter a valid HTTP proxy address".to_string())?;
    url.set_port(normalized.proxy_port)
        .map_err(|_| "Enter a valid proxy port".to_string())?;
    Ok(Some(url))
}

fn parse_network_proxy_base_url(value: &str) -> Result<String, String> {
    if value.is_empty() {
        return Err("Enter a proxy address".to_string());
    }
    let url = Url::parse(value).map_err(|_| "Enter a valid HTTP(S) proxy URL".to_string())?;
    let valid = matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some()
        && url.port().is_none()
        && url.path() == "/"
        && url.query().is_none()
        && url.fragment().is_none();
    if !valid {
        return Err("Use an HTTP proxy address without a port or path".to_string());
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

fn should_proxy_target(target: &Url) -> bool {
    let Some(host) = target.host_str() else {
        return false;
    };
    let host = host.trim_matches(['[', ']']);
    host != "localhost"
        && !host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|address| address.is_loopback())
}

fn parse_windows_proxy(
    proxy_server: &str,
    proxy_bypass: Option<&str>,
) -> Option<SystemProxyConfig> {
    let mut config = SystemProxyConfig {
        bypass: proxy_bypass
            .unwrap_or_default()
            .split(';')
            .map(str::trim)
            .filter(|entry| !entry.is_empty())
            .map(str::to_string)
            .collect(),
        ..SystemProxyConfig::default()
    };

    for entry in proxy_server.split(';').map(str::trim) {
        if entry.is_empty() {
            continue;
        }
        let Some((kind, endpoint)) = entry.split_once('=') else {
            if config.default_proxy.is_none() {
                config.default_proxy = parse_proxy_endpoint(entry);
            }
            continue;
        };
        match kind.trim().to_ascii_lowercase().as_str() {
            "http" => config.http_proxy = parse_proxy_endpoint(endpoint),
            "https" => config.https_proxy = parse_proxy_endpoint(endpoint),
            _ => {}
        }
    }

    (config.default_proxy.is_some() || config.http_proxy.is_some() || config.https_proxy.is_some())
        .then_some(config)
}

fn parse_proxy_endpoint(endpoint: &str) -> Option<Url> {
    let endpoint = endpoint.trim().trim_matches('"');
    if endpoint.is_empty() {
        return None;
    }
    let value = if endpoint.contains("://") {
        endpoint.to_string()
    } else {
        format!("http://{endpoint}")
    };
    Url::parse(&value)
        .ok()
        .filter(|url| matches!(url.scheme(), "http" | "https") && url.host_str().is_some())
}

fn bypass_rule_matches(rule: &str, host: &str, port: Option<u16>) -> bool {
    let rule = rule.trim().to_ascii_lowercase();
    if rule.is_empty() {
        return false;
    }
    if rule == "<local>" {
        return !host.contains('.');
    }
    if rule.starts_with("<-") && rule.ends_with('>') {
        return false;
    }

    let rule = rule
        .strip_prefix("http://")
        .or_else(|| rule.strip_prefix("https://"))
        .unwrap_or(&rule)
        .trim_end_matches('/');
    let (rule_host, rule_port) = split_bypass_host_port(rule);
    if rule_port.is_some() && rule_port != port {
        return false;
    }
    if let Some(suffix) = rule_host.strip_prefix('.') {
        return host == suffix || host.ends_with(&format!(".{suffix}"));
    }
    wildcard_matches(rule_host, host)
}

fn split_bypass_host_port(rule: &str) -> (&str, Option<u16>) {
    if let Some(rest) = rule.strip_prefix('[') {
        if let Some(closing) = rest.find(']') {
            let host = &rest[..closing];
            let port = rest[closing + 1..]
                .strip_prefix(':')
                .and_then(|value| value.parse().ok());
            return (host, port);
        }
    }
    if rule.matches(':').count() == 1 {
        if let Some((host, port)) = rule.rsplit_once(':') {
            if let Ok(port) = port.parse() {
                return (host, Some(port));
            }
        }
    }
    (rule.trim_matches(['[', ']']), None)
}

fn wildcard_matches(pattern: &str, value: &str) -> bool {
    let (pattern, value) = (pattern.as_bytes(), value.as_bytes());
    let (mut pattern_index, mut value_index) = (0, 0);
    let (mut star_index, mut star_value_index) = (None, 0);

    while value_index < value.len() {
        if pattern_index < pattern.len() && pattern[pattern_index] == value[value_index] {
            pattern_index += 1;
            value_index += 1;
        } else if pattern_index < pattern.len() && pattern[pattern_index] == b'*' {
            star_index = Some(pattern_index);
            pattern_index += 1;
            star_value_index = value_index;
        } else if let Some(star) = star_index {
            pattern_index = star + 1;
            star_value_index += 1;
            value_index = star_value_index;
        } else {
            return false;
        }
    }
    while pattern_index < pattern.len() && pattern[pattern_index] == b'*' {
        pattern_index += 1;
    }
    pattern_index == pattern.len()
}

#[cfg(target_os = "windows")]
fn current_system_proxy() -> Option<SystemProxyConfig> {
    use windows_sys::Win32::{
        Foundation::GlobalFree,
        Networking::WinHttp::{
            WinHttpGetIEProxyConfigForCurrentUser, WINHTTP_CURRENT_USER_IE_PROXY_CONFIG,
        },
    };

    let mut raw = WINHTTP_CURRENT_USER_IE_PROXY_CONFIG::default();
    if unsafe { WinHttpGetIEProxyConfigForCurrentUser(&mut raw) } == 0 {
        return None;
    }

    let proxy_server = wide_string(raw.lpszProxy);
    let proxy_bypass = wide_string(raw.lpszProxyBypass);
    unsafe {
        if !raw.lpszAutoConfigUrl.is_null() {
            GlobalFree(raw.lpszAutoConfigUrl.cast());
        }
        if !raw.lpszProxy.is_null() {
            GlobalFree(raw.lpszProxy.cast());
        }
        if !raw.lpszProxyBypass.is_null() {
            GlobalFree(raw.lpszProxyBypass.cast());
        }
    }

    parse_windows_proxy(proxy_server.as_deref()?, proxy_bypass.as_deref())
}

#[cfg(target_os = "windows")]
fn wide_string(value: *const u16) -> Option<String> {
    if value.is_null() {
        return None;
    }
    let mut length = 0;
    unsafe {
        while *value.add(length) != 0 {
            length += 1;
        }
        Some(String::from_utf16_lossy(std::slice::from_raw_parts(
            value, length,
        )))
    }
}

#[cfg(not(target_os = "windows"))]
fn current_system_proxy() -> Option<SystemProxyConfig> {
    None
}

#[cfg(test)]
mod tests {
    use reqwest::Url;

    use crate::models::NetworkProxySettings;

    use super::{
        bypass_rule_matches, network_proxy_url, normalize_settings, parse_windows_proxy,
        should_proxy_target, wildcard_matches,
    };

    #[test]
    fn normalizes_enabled_network_proxy() {
        let normalized = normalize_settings(NetworkProxySettings {
            enabled: true,
            proxy_url: " http://127.0.0.1/ ".to_string(),
            proxy_port: Some(7897),
        })
        .expect("proxy should normalize");

        assert_eq!(normalized.proxy_url, "http://127.0.0.1");
        assert_eq!(
            network_proxy_url(&normalized)
                .expect("proxy should parse")
                .map(|url| url.to_string()),
            Some("http://127.0.0.1:7897/".to_string())
        );
    }

    #[test]
    fn rejects_enabled_network_proxy_without_port() {
        let error = normalize_settings(NetworkProxySettings {
            enabled: true,
            proxy_url: "http://127.0.0.1".to_string(),
            proxy_port: None,
        })
        .expect_err("missing port should fail");

        assert!(error.contains("proxy port"));

        let zero_port_error = normalize_settings(NetworkProxySettings {
            enabled: true,
            proxy_url: "http://127.0.0.1".to_string(),
            proxy_port: Some(0),
        })
        .expect_err("zero port should fail");
        assert!(zero_port_error.contains("proxy port"));
    }

    #[test]
    fn rejects_proxy_address_without_url_scheme() {
        let error = normalize_settings(NetworkProxySettings {
            enabled: true,
            proxy_url: "127.0.0.1".to_string(),
            proxy_port: Some(7897),
        })
        .expect_err("proxy address without a URL scheme should fail");

        assert!(error.contains("proxy URL"));
    }

    #[test]
    fn explicit_network_proxy_bypasses_loopback_targets() {
        assert!(!should_proxy_target(
            &Url::parse("http://localhost:1455/callback").unwrap()
        ));
        assert!(!should_proxy_target(
            &Url::parse("http://127.0.0.1:3000/api").unwrap()
        ));
        assert!(should_proxy_target(
            &Url::parse("https://api.openai.com/v1/models").unwrap()
        ));
    }

    #[test]
    fn parses_clash_style_single_proxy_for_http_and_https() {
        let config = parse_windows_proxy("127.0.0.1:7897", Some("<local>;localhost;127.*"))
            .expect("proxy should parse");

        assert_eq!(
            config.default_proxy.as_ref().map(|url| url.as_str()),
            Some("http://127.0.0.1:7897/")
        );
        assert_eq!(config.bypass, ["<local>", "localhost", "127.*"]);
        assert_eq!(
            config
                .configured_proxy_for(&Url::parse("https://auth.openai.com/oauth").unwrap())
                .as_ref()
                .map(Url::as_str),
            Some("http://127.0.0.1:7897/")
        );
        assert!(config
            .configured_proxy_for(&Url::parse("http://localhost:1455/auth/callback").unwrap())
            .is_none());
    }

    #[test]
    fn parses_protocol_specific_windows_proxy_list() {
        let config = parse_windows_proxy(
            "http=127.0.0.1:7890;https=127.0.0.1:7891;socks=127.0.0.1:7892",
            None,
        )
        .expect("proxy should parse");

        assert_eq!(
            config.http_proxy.as_ref().map(|url| url.as_str()),
            Some("http://127.0.0.1:7890/")
        );
        assert_eq!(
            config.https_proxy.as_ref().map(|url| url.as_str()),
            Some("http://127.0.0.1:7891/")
        );
        assert!(config.default_proxy.is_none());
    }

    #[test]
    fn matches_windows_proxy_bypass_rules() {
        assert!(bypass_rule_matches("<local>", "intranet", Some(80)));
        assert!(!bypass_rule_matches("<local>", "example.com", Some(80)));
        assert!(bypass_rule_matches(
            "*.example.com",
            "api.example.com",
            Some(443)
        ));
        assert!(bypass_rule_matches("10.*", "10.2.3.4", Some(80)));
        assert!(bypass_rule_matches(
            "localhost:3000",
            "localhost",
            Some(3000)
        ));
        assert!(!bypass_rule_matches(
            "localhost:3000",
            "localhost",
            Some(3001)
        ));
        assert!(wildcard_matches("*", "anything.example"));
    }
}
