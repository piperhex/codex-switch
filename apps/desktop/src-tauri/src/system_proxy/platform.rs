use super::SystemProxyConfig;
#[cfg(target_os = "windows")]
use super::{parse_proxy_endpoint, parse_proxy_result, parse_windows_proxy};
#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
use reqwest::Url;

#[cfg(target_os = "windows")]
pub(super) fn current_system_proxy() -> Option<SystemProxyConfig> {
    use windows_sys::Win32::{
        Foundation::GlobalFree,
        Networking::WinHttp::{
            WinHttpGetIEProxyConfigForCurrentUser, WINHTTP_CURRENT_USER_IE_PROXY_CONFIG,
        },
    };

    let mut raw = WINHTTP_CURRENT_USER_IE_PROXY_CONFIG::default();
    // Safety: WinHTTP initializes `raw`, which remains valid for the duration of the call.
    if unsafe { WinHttpGetIEProxyConfigForCurrentUser(&mut raw) } == 0 {
        return None;
    }

    let proxy_server = wide_string(raw.lpszProxy);
    let proxy_bypass = wide_string(raw.lpszProxyBypass);
    let auto_config_url = wide_string(raw.lpszAutoConfigUrl);
    let auto_detect = raw.fAutoDetect != 0;
    // Safety: these non-null strings were allocated by WinHTTP and are released exactly once.
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

    let mut config = parse_windows_proxy(
        proxy_server.as_deref().unwrap_or_default(),
        proxy_bypass.as_deref(),
    )
    .unwrap_or_default();
    config.auto_config_url = auto_config_url;
    config.auto_detect = auto_detect;
    (config.default_proxy.is_some()
        || config.http_proxy.is_some()
        || config.https_proxy.is_some()
        || config.auto_config_url.is_some()
        || config.auto_detect)
        .then_some(config)
}

#[cfg(target_os = "windows")]
pub(super) fn windows_auto_proxy_for(config: &SystemProxyConfig, target: &Url) -> Option<Url> {
    use std::ptr;

    use windows_sys::Win32::{
        Foundation::GlobalFree,
        Networking::WinHttp::{
            WinHttpCloseHandle, WinHttpGetProxyForUrl, WinHttpOpen, WINHTTP_ACCESS_TYPE_NO_PROXY,
            WINHTTP_AUTOPROXY_AUTO_DETECT, WINHTTP_AUTOPROXY_CONFIG_URL,
            WINHTTP_AUTO_DETECT_TYPE_DHCP, WINHTTP_AUTO_DETECT_TYPE_DNS_A, WINHTTP_PROXY_INFO,
        },
    };

    let mut url = target.as_str().encode_utf16().collect::<Vec<_>>();
    url.push(0);
    let auto_config_url = config
        .auto_config_url
        .as_deref()
        .map(|value| value.encode_utf16().chain([0]).collect::<Vec<_>>());
    let mut options = windows_sys::Win32::Networking::WinHttp::WINHTTP_AUTOPROXY_OPTIONS {
        dwFlags: 0,
        dwAutoDetectFlags: 0,
        lpszAutoConfigUrl: ptr::null(),
        lpvReserved: ptr::null_mut(),
        dwReserved: 0,
        fAutoLogonIfChallenged: 1,
    };
    if let Some(auto_config_url) = auto_config_url.as_ref() {
        options.dwFlags |= WINHTTP_AUTOPROXY_CONFIG_URL;
        options.lpszAutoConfigUrl = auto_config_url.as_ptr();
    }
    if config.auto_detect {
        options.dwFlags |= WINHTTP_AUTOPROXY_AUTO_DETECT;
        options.dwAutoDetectFlags = WINHTTP_AUTO_DETECT_TYPE_DHCP | WINHTTP_AUTO_DETECT_TYPE_DNS_A;
    }
    if options.dwFlags == 0 {
        return None;
    }

    // Safety: null strings select a direct WinHTTP session and all arguments outlive the call.
    let session = unsafe {
        WinHttpOpen(
            ptr::null(),
            WINHTTP_ACCESS_TYPE_NO_PROXY,
            ptr::null(),
            ptr::null(),
            0,
        )
    };
    if session.is_null() {
        return None;
    }
    let mut info = WINHTTP_PROXY_INFO::default();
    // Safety: the session, URL, options, and output storage remain valid for the synchronous call.
    let resolved = unsafe { WinHttpGetProxyForUrl(session, url.as_ptr(), &mut options, &mut info) };
    // Safety: `session` is a valid WinHTTP handle and is closed exactly once.
    unsafe {
        WinHttpCloseHandle(session);
    }
    if resolved == 0 {
        return None;
    }
    let proxy_server = wide_string(info.lpszProxy);
    let proxy = proxy_server
        .as_deref()
        .and_then(parse_proxy_result)
        .or_else(|| proxy_server.as_deref().and_then(parse_proxy_endpoint));
    // Safety: these non-null strings were allocated by WinHTTP and are released exactly once.
    unsafe {
        if !info.lpszProxy.is_null() {
            GlobalFree(info.lpszProxy.cast());
        }
        if !info.lpszProxyBypass.is_null() {
            GlobalFree(info.lpszProxyBypass.cast());
        }
    }
    proxy
}

#[cfg(target_os = "windows")]
fn wide_string(value: *const u16) -> Option<String> {
    if value.is_null() {
        return None;
    }
    let mut length = 0;
    // Safety: WinHTTP returns a readable, null-terminated UTF-16 string for non-null pointers.
    unsafe {
        while *value.add(length) != 0 {
            length += 1;
        }
        Some(String::from_utf16_lossy(std::slice::from_raw_parts(
            value, length,
        )))
    }
}

#[cfg(target_os = "macos")]
pub(super) fn current_system_proxy() -> Option<SystemProxyConfig> {
    let output = std::process::Command::new("/usr/sbin/scutil")
        .arg("--proxy")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let values = String::from_utf8_lossy(&output.stdout);
    let mut config = SystemProxyConfig::default();
    let mut http_enabled = false;
    let mut https_enabled = false;
    let mut http_host = None;
    let mut https_host = None;
    let mut http_port = None;
    let mut https_port = None;
    for line in values.lines() {
        let Some((key, value)) = line.split_once(":") else {
            continue;
        };
        let key = key.trim();
        let value = value.trim().trim_matches('"');
        match key {
            "HTTPEnable" => http_enabled = value == "1",
            "HTTPProxy" => http_host = Some(value.to_string()),
            "HTTPPort" => http_port = value.parse().ok(),
            "HTTPSProxy" => https_host = Some(value.to_string()),
            "HTTPSPort" => https_port = value.parse().ok(),
            "HTTPSEnable" => https_enabled = value == "1",
            "ExceptionsList" => config.bypass.extend(parse_proxy_list(value)),
            _ => {}
        }
    }
    if http_enabled {
        config.http_proxy = http_host
            .as_deref()
            .and_then(|host| proxy_from_host_and_port(host, http_port));
    }
    if https_enabled {
        config.https_proxy = https_host
            .as_deref()
            .and_then(|host| proxy_from_host_and_port(host, https_port));
    }
    (config.http_proxy.is_some() || config.https_proxy.is_some()).then_some(config)
}

#[cfg(target_os = "linux")]
pub(super) fn current_system_proxy() -> Option<SystemProxyConfig> {
    let mode = std::process::Command::new("gsettings")
        .args(["get", "org.gnome.system.proxy", "mode"])
        .output()
        .ok()?;
    if !mode.status.success() || String::from_utf8_lossy(&mode.stdout).trim() != "'manual'" {
        return None;
    }
    let http_host = gsettings_value("org.gnome.system.proxy.http", "host")?;
    let http_port = gsettings_value("org.gnome.system.proxy.http", "port")?
        .parse()
        .ok()?;
    let https_host = gsettings_value("org.gnome.system.proxy.https", "host");
    let https_port =
        gsettings_value("org.gnome.system.proxy.https", "port").and_then(|port| port.parse().ok());
    let http_proxy = proxy_from_host_and_port(&http_host, Some(http_port));
    let https_proxy = https_host
        .as_deref()
        .and_then(|host| proxy_from_host_and_port(host, https_port))
        .or_else(|| http_proxy.clone());
    Some(SystemProxyConfig {
        default_proxy: None,
        http_proxy,
        https_proxy,
        bypass: gsettings_value("org.gnome.system.proxy", "ignore-hosts")
            .map(|value| parse_proxy_list(&value))
            .unwrap_or_default(),
    })
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn proxy_from_host_and_port(host: &str, port: Option<u16>) -> Option<Url> {
    let host = host.trim();
    if host.is_empty() {
        return None;
    }
    let mut url = Url::parse(&format!("http://{host}")).ok()?;
    url.set_port(port).ok()?;
    Some(url)
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn parse_proxy_list(value: &str) -> Vec<String> {
    value
        .trim_matches(['[', ']'])
        .split(',')
        .map(|entry| entry.trim().trim_matches(['"', '\'']).to_string())
        .filter(|entry| !entry.is_empty())
        .collect()
}

#[cfg(target_os = "linux")]
fn gsettings_value(schema: &str, key: &str) -> Option<String> {
    let output = std::process::Command::new("gsettings")
        .args(["get", schema, key])
        .output()
        .ok()?;
    output.status.success().then(|| {
        String::from_utf8_lossy(&output.stdout)
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .to_string()
    })
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub(super) fn current_system_proxy() -> Option<SystemProxyConfig> {
    None
}
