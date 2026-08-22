use std::{
    env,
    path::{Path, PathBuf},
};

use serde_yaml::{Mapping, Value};

use crate::{models::ProviderProfile, storage::write_text_atomic};

use super::{provider_context_window, provider_protocol, ProviderProtocol, MANAGED_PROVIDER_ID};

const DSH_API_KEY_ENV: &str = "CODEX_SWITCH_API_KEY";

pub(super) fn sync_hermes(home: &Path, provider: Option<&ProviderProfile>) -> Result<(), String> {
    let path = hermes_path(home);
    let mut config = read_yaml(&path)?;
    update_hermes_config(&mut config, provider)?;
    write_yaml(&path, &config)
}

pub(super) fn sync_deep_seek(
    home: &Path,
    provider: Option<&ProviderProfile>,
) -> Result<(), String> {
    let settings_path = deep_seek_settings_path(home);
    let credentials_path = settings_path
        .parent()
        .unwrap_or(home)
        .join(".credentials.yaml");
    let mut settings = read_yaml(&settings_path)?;
    let mut credentials = read_yaml(&credentials_path)?;
    update_deep_seek_settings(&mut settings, provider)?;
    update_deep_seek_credentials(&mut credentials, provider)?;
    write_yaml(&settings_path, &settings)?;
    write_yaml(&credentials_path, &credentials)
}

fn hermes_path(home: &Path) -> PathBuf {
    env::var_os("HERMES_HOME")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| {
            if cfg!(windows) {
                env::var_os("LOCALAPPDATA")
                    .map(PathBuf::from)
                    .unwrap_or_else(|| home.join("AppData").join("Local"))
                    .join("hermes")
            } else {
                home.join(".hermes")
            }
        })
        .join("config.yaml")
}

fn deep_seek_settings_path(home: &Path) -> PathBuf {
    env::var_os("DSH_HOME")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| home.join(".dsh"))
        .join("settings.yaml")
}

fn read_yaml(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(Value::Mapping(Mapping::new()));
    }
    let content = std::fs::read_to_string(path)
        .map_err(|error| format!("无法读取 {}：{error}", path.display()))?;
    if content.trim().is_empty() {
        return Ok(Value::Mapping(Mapping::new()));
    }
    serde_yaml::from_str(&content)
        .map_err(|error| format!("{} 的 YAML 格式无效：{error}", path.display()))
}

fn write_yaml(path: &Path, value: &Value) -> Result<(), String> {
    let content = serde_yaml::to_string(value)
        .map_err(|error| format!("序列化 {} 失败：{error}", path.display()))?;
    write_text_atomic(path, &content)
}

fn mapping(value: &mut Value) -> Result<&mut Mapping, String> {
    value
        .as_mapping_mut()
        .ok_or_else(|| "应用 YAML 配置的根节点必须是对象".to_string())
}

fn child_mapping<'a>(parent: &'a mut Mapping, key: &str) -> &'a mut Mapping {
    let key = Value::String(key.to_string());
    let value = parent
        .entry(key)
        .or_insert_with(|| Value::Mapping(Mapping::new()));
    if !value.is_mapping() {
        *value = Value::Mapping(Mapping::new());
    }
    value
        .as_mapping_mut()
        .expect("value was replaced with a mapping")
}

fn text(value: &str) -> Value {
    Value::String(value.to_string())
}

fn update_hermes_config(
    config: &mut Value,
    provider: Option<&ProviderProfile>,
) -> Result<(), String> {
    let root = mapping(config)?;
    {
        let list = root
            .entry(text("custom_providers"))
            .or_insert_with(|| Value::Sequence(Vec::new()));
        let providers = list
            .as_sequence_mut()
            .ok_or_else(|| "Hermes 的 custom_providers 必须是数组".to_string())?;
        providers
            .retain(|entry| entry.get("name").and_then(Value::as_str) != Some(MANAGED_PROVIDER_ID));
        let Some(provider) = provider else {
            return Ok(());
        };
        providers.push(hermes_provider(provider));
    }
    let Some(provider) = provider else {
        return Ok(());
    };

    let model = child_mapping(root, "model");
    model.insert(text("default"), text(&provider.model));
    model.insert(text("provider"), text(MANAGED_PROVIDER_ID));
    model.insert(text("base_url"), text(&provider.base_url));
    model.insert(text("api_key"), text(&provider.api_key));
    model.insert(
        text("api_mode"),
        text(hermes_api_mode(provider_protocol(provider))),
    );
    Ok(())
}

fn hermes_provider(provider: &ProviderProfile) -> Value {
    let mut entry = Mapping::new();
    entry.insert(text("name"), text(MANAGED_PROVIDER_ID));
    entry.insert(text("base_url"), text(&provider.base_url));
    entry.insert(text("api_key"), text(&provider.api_key));
    entry.insert(
        text("api_mode"),
        text(hermes_api_mode(provider_protocol(provider))),
    );
    entry.insert(
        text("models"),
        Value::Sequence(vec![Value::Mapping({
            let mut model = Mapping::new();
            model.insert(text("id"), text(&provider.model));
            model.insert(text("name"), text(&provider.model));
            model.insert(
                text("context_length"),
                Value::Number(provider_context_window(provider).into()),
            );
            model
        })]),
    );
    Value::Mapping(entry)
}

fn hermes_api_mode(protocol: ProviderProtocol) -> &'static str {
    match protocol {
        ProviderProtocol::Anthropic => "anthropic_messages",
        ProviderProtocol::OpenaiResponses => "codex_responses",
        ProviderProtocol::OpenaiChat => "chat_completions",
    }
}

fn update_deep_seek_settings(
    config: &mut Value,
    provider: Option<&ProviderProfile>,
) -> Result<(), String> {
    let Some(provider) = provider else {
        let root = mapping(config)?;
        if let Some(llm) = root
            .get_mut(text("llm-pi-ai"))
            .and_then(Value::as_mapping_mut)
        {
            if let Some(providers) = llm
                .get_mut(text("providers"))
                .and_then(Value::as_mapping_mut)
            {
                providers.remove(text(MANAGED_PROVIDER_ID));
            }
        }
        return Ok(());
    };
    let mut route = Mapping::new();
    route.insert(text("displayName"), text(MANAGED_PROVIDER_ID));
    route.insert(text("apiKeyEnv"), text(DSH_API_KEY_ENV));
    route.insert(
        text("api"),
        text(deep_seek_api(provider_protocol(provider))),
    );
    route.insert(text("baseURL"), text(&provider.base_url));
    route.insert(
        text("models"),
        Value::Sequence(vec![Value::Mapping({
            let mut model = Mapping::new();
            model.insert(text("id"), text(&provider.model));
            model.insert(text("name"), text(&provider.model));
            model
        })]),
    );
    let root = mapping(config)?;
    {
        let llm = child_mapping(root, "llm-pi-ai");
        let providers = child_mapping(llm, "providers");
        providers.insert(text(MANAGED_PROVIDER_ID), Value::Mapping(route));
    }

    let mut selector = Mapping::new();
    selector.insert(text("provider"), text(MANAGED_PROVIDER_ID));
    selector.insert(text("model"), text(&provider.model));
    root.insert(text("agent-default-model"), Value::Mapping(selector));
    Ok(())
}

fn update_deep_seek_credentials(
    config: &mut Value,
    provider: Option<&ProviderProfile>,
) -> Result<(), String> {
    let root = mapping(config)?;
    match provider {
        Some(provider) => {
            root.insert(text(DSH_API_KEY_ENV), text(&provider.api_key));
        }
        None => {
            root.remove(text(DSH_API_KEY_ENV));
        }
    }
    Ok(())
}

fn deep_seek_api(protocol: ProviderProtocol) -> &'static str {
    match protocol {
        ProviderProtocol::Anthropic => "anthropic-messages",
        ProviderProtocol::OpenaiResponses => "openai-responses",
        ProviderProtocol::OpenaiChat => "openai-completions",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::third_party_apps::tests::provider;

    #[test]
    fn hermes_update_keeps_existing_custom_providers() {
        let mut config = serde_yaml::from_str("custom_providers:\n  - name: keep\n").unwrap();
        let provider = provider();
        update_hermes_config(&mut config, Some(&provider)).unwrap();
        assert_eq!(config["custom_providers"][0]["name"], "keep");
        assert_eq!(config["model"]["provider"], MANAGED_PROVIDER_ID);
    }

    #[test]
    fn deep_seek_update_writes_route_and_selector() {
        let mut config = Value::Mapping(Mapping::new());
        let mut provider = provider();
        provider.api_format = crate::models::ProviderApiFormat::OpenaiResponses;
        update_deep_seek_settings(&mut config, Some(&provider)).unwrap();
        assert_eq!(
            config["agent-default-model"]["provider"],
            MANAGED_PROVIDER_ID
        );
        assert_eq!(
            config["llm-pi-ai"]["providers"][MANAGED_PROVIDER_ID]["api"],
            "openai-responses"
        );
    }
}
