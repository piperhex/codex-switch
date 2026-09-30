use super::*;
use std::{
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};
use windows_sys::Win32::Networking::WinHttp::{
    ERROR_WINHTTP_LOGIN_FAILURE, ERROR_WINHTTP_UNABLE_TO_DOWNLOAD_SCRIPT,
    WINHTTP_ACCESS_TYPE_NAMED_PROXY, WINHTTP_ACCESS_TYPE_NO_PROXY, WINHTTP_AUTOPROXY_AUTO_DETECT,
    WINHTTP_AUTOPROXY_CONFIG_URL, WINHTTP_AUTOPROXY_NO_CACHE_CLIENT,
    WINHTTP_AUTOPROXY_NO_CACHE_SVC, WINHTTP_PROXY_INFO,
};

#[test]
fn automatic_proxy_discovery_caches_scripts_and_retries_only_authentication_challenges() {
    let config = SystemProxyConfig {
        auto_detect: true,
        ..Default::default()
    };
    let mut options = auto_proxy_options(&config, None).unwrap();
    let mut attempts = Vec::new();
    let result = lookup_with_auth_retry(&mut options, |options| {
        attempts.push(options.fAutoLogonIfChallenged);
        if attempts.len() == 1 {
            Err(ERROR_WINHTTP_LOGIN_FAILURE)
        } else {
            Ok(())
        }
    });
    assert!(result.is_ok());
    assert_eq!(attempts, [0, 1]);

    let mut options = auto_proxy_options(&config, None).unwrap();
    let mut attempts = 0;
    let result = lookup_with_auth_retry(&mut options, |options| {
        attempts += 1;
        assert_eq!(options.fAutoLogonIfChallenged, 0);
        Err(ERROR_WINHTTP_UNABLE_TO_DOWNLOAD_SCRIPT)
    });
    assert_eq!(result, Err(ERROR_WINHTTP_UNABLE_TO_DOWNLOAD_SCRIPT));
    assert_eq!(attempts, 1);
}

#[test]
fn automatic_proxy_options_recheck_each_url_without_enabling_unconfigured_discovery() {
    let config = SystemProxyConfig {
        auto_detect: true,
        ..Default::default()
    };
    let cache_flags = WINHTTP_AUTOPROXY_NO_CACHE_CLIENT | WINHTTP_AUTOPROXY_NO_CACHE_SVC;
    let discovery = auto_proxy_options(&config, None).unwrap();
    assert_eq!(
        discovery.dwFlags,
        WINHTTP_AUTOPROXY_AUTO_DETECT | cache_flags
    );
    assert_eq!(discovery.fAutoLogonIfChallenged, 0);
    let pac_url = "http://127.0.0.1/proxy.pac\0"
        .encode_utf16()
        .collect::<Vec<_>>();
    let explicit = auto_proxy_options(&config, Some(&pac_url)).unwrap();
    assert_eq!(explicit.dwFlags, WINHTTP_AUTOPROXY_CONFIG_URL | cache_flags);
    assert_eq!(explicit.dwAutoDetectFlags, 0);
    assert_eq!(explicit.fAutoLogonIfChallenged, 0);
    assert!(auto_proxy_options(&SystemProxyConfig::default(), None).is_none());
}

#[test]
fn winhttp_access_type_and_bypass_are_respected() {
    let target = Url::parse("https://api.example.com/v1").unwrap();
    let mut proxy = "http=127.0.0.1:8080;https=127.0.0.1:8081"
        .encode_utf16()
        .chain([0])
        .collect::<Vec<_>>();
    let mut bypass = "*.example.com"
        .encode_utf16()
        .chain([0])
        .collect::<Vec<_>>();
    let mut info = WINHTTP_PROXY_INFO {
        dwAccessType: WINHTTP_ACCESS_TYPE_NAMED_PROXY,
        lpszProxy: proxy.as_mut_ptr(),
        lpszProxyBypass: std::ptr::null_mut(),
    };
    assert_eq!(
        proxy_decision(&info, &target),
        Some(ProxyDecision::Proxy(
            Url::parse("http://127.0.0.1:8081").unwrap()
        ))
    );
    info.lpszProxyBypass = bypass.as_mut_ptr();
    assert_eq!(proxy_decision(&info, &target), Some(ProxyDecision::Direct));
    info.lpszProxyBypass = std::ptr::null_mut();
    info.dwAccessType = WINHTTP_ACCESS_TYPE_NO_PROXY;
    assert_eq!(proxy_decision(&info, &target), Some(ProxyDecision::Direct));
}

#[test]
fn native_pac_resolution_preserves_direct_and_uses_the_complete_url() {
    let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
    let mut config = parse_windows_proxy("127.0.0.1:1", None).unwrap();
    config.auto_config_url = Some(format!("http://{}/proxy.pac", server.server_addr()));
    config.auto_detect = true;
    let (finish, pending) = mpsc::channel();
    let worker = thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(10);
        while pending.try_recv().is_err() && Instant::now() < deadline {
            if let Some(request) = server.recv_timeout(Duration::from_millis(50)).unwrap() {
                let script = "function FindProxyForURL(url, host) { \
                    if (url.indexOf('/direct') >= 0 || url.indexOf('bypass=1') >= 0) return 'DIRECT'; \
                    return 'PROXY 127.0.0.1:54321'; }";
                request
                    .respond(
                        tiny_http::Response::from_string(script).with_header(
                            tiny_http::Header::from_bytes(
                                "Content-Type",
                                "application/x-ns-proxy-autoconfig",
                            )
                            .unwrap(),
                        ),
                    )
                    .unwrap();
            }
        }
    });
    let decisions = [
        "http://destination.invalid/direct",
        "http://destination.invalid/proxy",
        "http://destination.invalid/proxy?bypass=1",
        "http://destination.invalid/proxy?bypass=0",
        "http://other.invalid/proxy",
        "http://other.invalid/direct",
    ]
    .map(|url| config.proxy_for(&Url::parse(url).unwrap()));
    finish.send(()).unwrap();
    worker.join().unwrap();
    let proxy = Some(Url::parse("http://127.0.0.1:54321").unwrap());
    assert_eq!(
        decisions,
        [None, proxy.clone(), None, proxy.clone(), proxy, None]
    );
}
