#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompatibleJsonImportResult {
    pub(crate) imported_ids: Vec<String>,
    pub(crate) skipped: Vec<String>,
}

#[derive(Default)]
struct CompatibleJsonAccountMetadata {
    note: Option<String>,
    expires_at: Option<String>,
    auto_switch_priority: Option<i32>,
    disabled: Option<bool>,
}

#[derive(Default)]
struct CompatibleJsonAuthTokens {
    id_token: Option<String>,
    access_token: Option<String>,
    refresh_token: Option<String>,
    session_token: Option<String>,
}

impl CompatibleJsonAuthTokens {
    fn has_any(&self) -> bool {
        self.id_token.is_some()
            || self.access_token.is_some()
            || self.refresh_token.is_some()
            || self.session_token.is_some()
    }
}

/// Imports the common Codex token layouts used by account managers and session exports.
/// The stored result is always reduced to this app's canonical auth.json shape before validation.
#[tauri::command]
pub(crate) fn import_compatible_json_file<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<CompatibleJsonImportResult, String> {
    let content =
        fs::read_to_string(&path).map_err(|error| format!("读取 {} 失败：{error}", path))?;
    let auth_values = parse_compatible_json_auth_values(&content)?;
    import_normalized_json_auth_values(&app, &auth_values, normalize_compatible_json_auth)
}

fn import_normalized_json_auth_values<R: Runtime>(
    app: &tauri::AppHandle<R>,
    auth_values: &[Value],
    normalize: fn(&Value) -> Result<Value, String>,
) -> Result<CompatibleJsonImportResult, String> {
    let mut normalized = Vec::new();
    let mut skipped = Vec::new();
    for (index, value) in auth_values.iter().enumerate() {
        match normalize(value) {
            Ok(auth) => normalized.push((auth, compatible_json_account_metadata(value))),
            Err(error) => skipped.push(format!("第 {} 个账号：{error}", index + 1)),
        }
    }
    if normalized.is_empty() {
        return Err(skipped
            .first()
            .cloned()
            .unwrap_or_else(|| "没有找到可导入的账号".to_string()));
    }

    let mut imported_ids = Vec::new();
    let paths = resolve_paths(app)?;
    let mut state = read_state(&paths);
    let mut state_changed = false;
    for (auth, metadata) in normalized {
        let id = import_value(app, auth, false)?;
        if let Some(note) = metadata.note {
            save_note(&note_path(&paths, &id), &note)?;
        }
        if let Some(expires_at) = metadata.expires_at {
            save_expiration(&expiration_path(&paths, &id), &expires_at)?;
        }
        if let Some(priority) = metadata.auto_switch_priority {
            save_auto_switch_priority(&auto_switch_priority_path(&paths, &id), priority)?;
        }
        if metadata.disabled == Some(true) {
            state_changed |= update_disabled_account_ids(&mut state, &id, false);
        }
        if !imported_ids.contains(&id) {
            imported_ids.push(id);
        }
    }
    if state_changed {
        write_state(&paths, &state)?;
    }

    app.emit("accounts-changed", ())
        .map_err(|error| error.to_string())?;
    crate::system_tray::refresh_menu(app);
    Ok(CompatibleJsonImportResult {
        imported_ids,
        skipped,
    })
}

/// Imports the explicit `sub2api-data` export format and converts each supported
/// OpenAI OAuth or Agent Identity account into the auth.json shape consumed by Codex.
#[tauri::command]
pub(crate) fn import_sub2api_json_file<R: Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<CompatibleJsonImportResult, String> {
    let content =
        fs::read_to_string(&path).map_err(|error| format!("读取 {} 失败：{error}", path))?;
    let auth_values = parse_sub2api_auth_values(&content)?;
    import_normalized_json_auth_values(&app, &auth_values, normalize_sub2api_auth)
}

fn parse_sub2api_auth_values(content: &str) -> Result<Vec<Value>, String> {
    let content = content.trim_start_matches('\u{feff}').trim();
    if content.is_empty() {
        return Err("导入文件为空".to_string());
    }
    let value: Value =
        serde_json::from_str(content).map_err(|error| format!("sub2api JSON 格式无效：{error}"))?;
    let object = value
        .as_object()
        .ok_or_else(|| "sub2api 导出文件顶层必须是 JSON 对象".to_string())?;
    if object
        .get("type")
        .is_some_and(|value| value.as_str() != Some("sub2api-data"))
    {
        return Err("不是有效的 sub2api 账号文件".to_string());
    }
    if object
        .get("version")
        .is_some_and(|value| value.as_i64() != Some(1))
    {
        return Err("仅支持 version=1 的 sub2api 导出文件".to_string());
    }
    let accounts = object
        .get("accounts")
        .and_then(Value::as_array)
        .ok_or_else(|| "sub2api 导出文件缺少 accounts 数组".to_string())?;
    if accounts.is_empty() {
        return Err("sub2api 导出文件中没有账号".to_string());
    }
    if accounts.len() > 1000 {
        return Err("单次最多导入 1000 个账号".to_string());
    }
    Ok(accounts.clone())
}

fn sub2api_required_string<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .ok_or_else(|| format!("sub2api credentials 缺少 {key}"))
}

fn normalize_sub2api_auth(value: &Value) -> Result<Value, String> {
    let account = value
        .as_object()
        .ok_or_else(|| "sub2api account 必须是 JSON 对象".to_string())?;
    if account.get("platform").and_then(Value::as_str) != Some("openai")
        || account.get("type").and_then(Value::as_str) != Some("oauth")
    {
        return Err("仅支持 platform=openai、type=oauth 的账号".to_string());
    }
    let credentials = account
        .get("credentials")
        .ok_or_else(|| "sub2api account 缺少 credentials".to_string())?;
    let auth_mode = credentials
        .get("auth_mode")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if !auth_mode.eq_ignore_ascii_case("agentIdentity") {
        let mut tokens = serde_json::Map::new();
        tokens.insert(
            "access_token".to_string(),
            Value::String(sub2api_required_string(credentials, "access_token")?.to_string()),
        );
        for key in ["id_token", "refresh_token"] {
            let value = credentials
                .get(key)
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or_default();
            tokens.insert(key.to_string(), Value::String(value.to_string()));
        }
        for (source, target) in [
            ("chatgpt_account_id", "account_id"),
            ("chatgpt_user_id", "chatgpt_user_id"),
            ("email", "email"),
            ("plan_type", "plan_type"),
            ("organization_id", "organization_id"),
            ("expires_at", "expires_at"),
        ] {
            if let Some(value) = credentials
                .get(source)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|item| !item.is_empty())
            {
                tokens.insert(target.to_string(), Value::String(value.to_string()));
            }
        }

        let mut auth = serde_json::Map::new();
        auth.insert(
            "auth_mode".to_string(),
            Value::String("chatgpt".to_string()),
        );
        auth.insert("OPENAI_API_KEY".to_string(), Value::Null);
        auth.insert("tokens".to_string(), Value::Object(tokens));
        auth.insert(
            "last_refresh".to_string(),
            Value::String(Utc::now().to_rfc3339()),
        );
        let mut auth = Value::Object(auth);
        canonicalize_chatgpt_auth(&mut auth)?;
        validate_auth(&auth)?;
        return Ok(auth);
    }

    let mut identity = serde_json::Map::new();
    for key in [
        "agent_runtime_id",
        "agent_private_key",
        "account_id",
        "chatgpt_user_id",
    ] {
        identity.insert(
            key.to_string(),
            Value::String(sub2api_required_string(credentials, key)?.to_string()),
        );
    }
    for key in ["task_id", "email", "plan_type"] {
        if let Some(value) = credentials
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|item| !item.is_empty())
        {
            identity.insert(key.to_string(), Value::String(value.to_string()));
        }
    }
    identity.insert(
        "chatgpt_account_is_fedramp".to_string(),
        Value::Bool(
            credentials
                .get("chatgpt_account_is_fedramp")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        ),
    );

    let mut auth = serde_json::Map::new();
    auth.insert(
        "auth_mode".to_string(),
        Value::String("agentIdentity".to_string()),
    );
    auth.insert("agent_identity".to_string(), Value::Object(identity));
    let auth = Value::Object(auth);
    validate_auth(&auth)?;
    Ok(auth)
}
