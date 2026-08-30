use super::*;
use crate::prompt_plugins::{PromptPluginItem, PromptPluginType};

pub(crate) fn fetch_prompt_plugins<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<Vec<PromptPluginItem>, String> {
    let client = api_client()?;
    let settings = read_app_settings(app)?;
    let response = client
        .get(endpoint(&settings, "/prompt-plugins")?)
        .header("Accept", "application/json")
        .send()
        .map_err(|error| format!("Prompt plugin market request failed: {error}"))?;
    if !response.status().is_success() {
        return Err(response_error("Prompt plugin market request", response));
    }
    response
        .json::<PromptPluginResponse>()
        .map(|value| value.items)
        .map_err(|error| format!("Prompt plugin response is invalid: {error}"))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PromptPluginResponse {
    items: Vec<PromptPluginItem>,
}

pub(crate) fn fetch_prompt_plugin<R: Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
) -> Result<PromptPluginItem, String> {
    let client = api_client()?;
    let settings = read_app_settings(app)?;
    let response = client
        .get(endpoint(
            &settings,
            &format!("/prompt-plugins/{id}/install"),
        )?)
        .header("Accept", "application/json")
        .send()
        .map_err(|error| format!("Prompt plugin download failed: {error}"))?;
    if !response.status().is_success() {
        return Err(response_error("Prompt plugin download", response));
    }
    response
        .json()
        .map_err(|error| format!("Prompt plugin response is invalid: {error}"))
}

pub(crate) fn publish_prompt_plugin<R: Runtime>(
    app: &tauri::AppHandle<R>,
    name: &str,
    version: &str,
    plugin_type: PromptPluginType,
    text: &str,
) -> Result<PromptPluginItem, String> {
    let _guard = lock_cloud_credentials()?;
    let client = feedback_client()?;
    let settings = read_app_settings(app)?;
    let credentials = read_cloud_credentials(app);
    let token = credentials
        .access_token
        .as_deref()
        .ok_or_else(|| "Please sign in before publishing a prompt plugin".to_string())?;
    let response = client.post(endpoint(&settings, "/prompt-plugins")?).bearer_auth(token)
        .json(&serde_json::json!({ "name": name, "version": version, "type": plugin_type, "text": text }))
        .send().map_err(|error| format!("Prompt plugin upload failed: {error}"))?;
    if !response.status().is_success() {
        return Err(response_error("Prompt plugin upload", response));
    }
    response
        .json()
        .map_err(|error| format!("Prompt plugin response is invalid: {error}"))
}
