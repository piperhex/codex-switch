use std::{fs, path::PathBuf, thread};

use serde_json::json;
use tiny_http::{Response, Server};

use super::*;

struct Fixture {
    root: PathBuf,
    paths: Paths,
}

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("model-version-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let paths = Paths {
            codex_home: root.clone(),
            current_auth: root.join("auth.json"),
            current_config: root.join("config.toml"),
            accounts: root.join("accounts"),
            providers: root.join("providers"),
            config_backup: root.join("config.backup"),
            state_file: root.join("state.json"),
        };
        Self { root, paths }
    }

    fn cache(&self, cli: &str, switch: &str) {
        for (path, version) in [
            (self.root.join("models_cache.json"), cli),
            (super::super::cache_path(&self.paths), switch),
        ] {
            fs::write(path, json!({"client_version": version}).to_string()).unwrap();
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.root).unwrap();
    }
}

fn registry_client() -> Client {
    Client::builder()
        .no_proxy()
        .timeout(RELEASE_LOOKUP_TIMEOUT)
        .build()
        .unwrap()
}

#[test]
fn each_refresh_fetches_the_latest_release_despite_an_old_cli_cache() {
    let fixture = Fixture::new();
    fixture.cache("0.153.4", "0.153.4");
    let server = Server::http("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/@openai/codex/latest", server.server_addr());
    let worker = thread::spawn(move || {
        for version in ["0.155.0", "0.156.0"] {
            let request = server
                .recv_timeout(RELEASE_LOOKUP_TIMEOUT)
                .unwrap()
                .unwrap();
            assert_eq!(request.url(), "/@openai/codex/latest");
            assert!(request.headers().iter().any(|header| {
                header.field.equiv("Cache-Control") && header.value.as_str() == "no-cache"
            }));
            assert!(!request
                .headers()
                .iter()
                .any(|header| header.field.equiv("Authorization")));
            request
                .respond(Response::from_string(
                    json!({"version": version}).to_string(),
                ))
                .unwrap();
        }
    });
    let client = registry_client();
    for expected in ["0.155.0", "0.156.0"] {
        assert_eq!(
            resolve_model_client_version(&fixture.paths, || fetch_latest_version(
                &client, &endpoint
            )),
            expected
        );
    }
    worker.join().unwrap();
}

#[test]
fn failed_or_invalid_release_lookups_keep_the_successful_switch_version() {
    let fixture = Fixture::new();
    fixture.cache("0.153.4", "0.155.0");
    let server = Server::http("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/latest", server.server_addr());
    let worker = thread::spawn(move || {
        for (status, body) in [
            (503, r#"{"version":"0.156.0"}"#),
            (200, "invalid json"),
            (200, "{}"),
            (200, r#"{"version":"invalid"}"#),
            (200, r#"{"version":"0.157.0-alpha.1"}"#),
        ] {
            server
                .recv_timeout(RELEASE_LOOKUP_TIMEOUT)
                .unwrap()
                .unwrap()
                .respond(Response::from_string(body).with_status_code(status))
                .unwrap();
        }
    });
    let client = registry_client();
    for _ in 0..5 {
        assert_eq!(
            resolve_model_client_version(&fixture.paths, || fetch_latest_version(
                &client, &endpoint
            )),
            "0.155.0"
        );
    }
    worker.join().unwrap();
    assert_eq!(
        cached_version(&super::super::cache_path(&fixture.paths))
            .unwrap()
            .to_string(),
        "0.155.0"
    );
}

#[test]
fn offline_selection_uses_the_highest_valid_stable_version() {
    let fixture = Fixture::new();
    for (cli, switch, expected) in [
        ("0.156.0", "0.155.0", "0.156.0"),
        ("0.153.4", "0.155.0", "0.155.0"),
        ("0.155.0+build.1", "broken", "0.155.0"),
        ("0.144.0", "0.151.0", MIN_CODEX_MODEL_CLIENT_VERSION),
        ("0.156.0-alpha.1", "broken", MIN_CODEX_MODEL_CLIENT_VERSION),
    ] {
        fixture.cache(cli, switch);
        assert_eq!(
            resolve_model_client_version(&fixture.paths, || Err(
                ReleaseLookupError::InvalidVersion
            )),
            expected
        );
    }
}

#[test]
fn missing_caches_use_latest_release_or_minimum_when_offline() {
    let fixture = Fixture::new();
    assert_eq!(
        resolve_model_client_version(&fixture.paths, || Ok(Version::new(0, 155, 0))),
        "0.155.0"
    );
    assert_eq!(
        resolve_model_client_version(&fixture.paths, || Err(ReleaseLookupError::InvalidVersion)),
        MIN_CODEX_MODEL_CLIENT_VERSION
    );
}

#[test]
fn release_lookup_never_downgrades_a_newer_successful_cache() {
    let fixture = Fixture::new();
    fixture.cache("0.153.4", "0.156.0");
    assert_eq!(
        resolve_model_client_version(&fixture.paths, || Ok(Version::new(0, 155, 0))),
        "0.156.0"
    );
}
