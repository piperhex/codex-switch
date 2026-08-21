fn parse_compatible_json_auth_values(content: &str) -> Result<Vec<Value>, String> {
    let content = content.trim_start_matches('\u{feff}').trim();
    if content.is_empty() {
        return Err("导入文件为空".to_string());
    }

    match serde_json::from_str::<Value>(content) {
        Ok(value) => collect_compatible_json_accounts(&value),
        Err(parse_error) => parse_embedded_compatible_json(content)
            .map_err(|detail| format!("JSON 格式无效：{parse_error}；{detail}")),
    }
}

fn collect_compatible_json_accounts(value: &Value) -> Result<Vec<Value>, String> {
    let mut found = Vec::new();
    collect_compatible_json_accounts_at(value, 0, &mut found);
    if found.is_empty() {
        return Err("没有找到包含 Codex token 的账号对象".to_string());
    }
    if found.len() > 1000 {
        return Err("单次最多导入 1000 个账号".to_string());
    }
    Ok(found)
}

fn collect_compatible_json_accounts_at(value: &Value, depth: usize, found: &mut Vec<Value>) {
    if depth > 12 || found.len() > 1000 {
        return;
    }
    match value {
        Value::Array(items) => {
            for item in items {
                collect_compatible_json_accounts_at(item, depth + 1, found);
            }
        }
        Value::Object(object) => {
            if has_direct_compatible_json_token(value) {
                found.push(value.clone());
                return;
            }
            for (key, nested) in object {
                if matches!(
                    key.as_str(),
                    "accessToken" | "access_token" | "sessionToken"
                ) {
                    continue;
                }
                if let Value::String(raw) = nested {
                    if [
                        "auth",
                        "auth_json",
                        "authJson",
                        "session",
                        "session_json",
                        "sessionJson",
                    ]
                    .contains(&key.as_str())
                    {
                        if let Ok(parsed) = serde_json::from_str::<Value>(raw) {
                            collect_compatible_json_accounts_at(&parsed, depth + 1, found);
                        }
                    }
                } else {
                    collect_compatible_json_accounts_at(nested, depth + 1, found);
                }
            }
        }
        _ => {}
    }
}

fn has_direct_compatible_json_token(value: &Value) -> bool {
    first_compatible_json_string(
        value,
        &[
            &["id_token"],
            &["idToken"],
            &["access_token"],
            &["accessToken"],
            &["refresh_token"],
            &["refreshToken"],
            &["tokens", "id_token"],
            &["tokens", "idToken"],
            &["tokens", "access_token"],
            &["tokens", "accessToken"],
            &["tokens", "refresh_token"],
            &["tokens", "refreshToken"],
            &["token", "id_token"],
            &["token", "idToken"],
            &["token", "access_token"],
            &["token", "accessToken"],
            &["token", "refresh_token"],
            &["token", "refreshToken"],
            &["credentials", "id_token"],
            &["credentials", "idToken"],
            &["credentials", "access_token"],
            &["credentials", "accessToken"],
            &["credentials", "refresh_token"],
            &["credentials", "refreshToken"],
        ],
    )
    .is_some()
}

fn parse_embedded_compatible_json(content: &str) -> Result<Vec<Value>, String> {
    let mut values = Vec::new();
    for slice in extract_json_slices(content) {
        if let Ok(value) = serde_json::from_str::<Value>(slice) {
            values.extend(collect_compatible_json_accounts(&value).unwrap_or_default());
        }
    }
    if values.is_empty() {
        return Err("未找到可解析的账号 JSON".to_string());
    }
    if values.len() > 1000 {
        return Err("单次最多导入 1000 个账号".to_string());
    }
    Ok(values)
}

fn extract_json_slices(content: &str) -> Vec<&str> {
    let mut slices = Vec::new();
    let mut stack = Vec::new();
    let mut start = None;
    let mut in_string = false;
    let mut escaped = false;
    for (index, character) in content.char_indices() {
        if in_string {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                in_string = false;
            }
            continue;
        }
        if character == '"' {
            if !stack.is_empty() {
                in_string = true;
            }
        } else if matches!(character, '{' | '[') {
            if stack.is_empty() {
                start = Some(index);
            }
            stack.push(character);
        } else if matches!(character, '}' | ']') {
            let Some(open) = stack.pop() else {
                continue;
            };
            if !matches!((open, character), ('{', '}') | ('[', ']')) {
                stack.clear();
                start = None;
            } else if stack.is_empty() {
                if let Some(start) = start.take() {
                    slices.push(&content[start..index + character.len_utf8()]);
                }
            }
        }
    }
    slices
}

fn normalize_compatible_json_auth(value: &Value) -> Result<Value, String> {
    let tokens = extract_compatible_json_tokens(value, 0).ok_or_else(|| {
        "未找到可用的 Codex token；支持 access_token/accessToken、完整 tokens、session/session_json 或 refresh_token"
            .to_string()
    })?;

    let mut token_object = serde_json::Map::new();
    if let Some(access_token) = tokens.access_token {
        token_object.insert("access_token".to_string(), Value::String(access_token));
    }
    if let Some(id_token) = tokens
        .id_token
        .filter(|token| crate::auth::decode_jwt(token).is_ok())
    {
        token_object.insert("id_token".to_string(), Value::String(id_token));
    }
    if let Some(refresh_token) = tokens
        .refresh_token
        .filter(|token| token != "__missing_refresh_token__")
    {
        token_object.insert("refresh_token".to_string(), Value::String(refresh_token));
    }
    if let Some(session_token) = tokens.session_token {
        token_object.insert("session_token".to_string(), Value::String(session_token));
    }
    for (target, paths) in [
        (
            "account_id",
            &[
                &["account", "id"][..],
                &["account_id"][..],
                &["chatgptAccountId"][..],
                &["chatgpt_account_id"][..],
                &["tokens", "accountId"][..],
                &["tokens", "account_id"][..],
                &["tokens", "chatgptAccountId"][..],
                &["tokens", "chatgpt_account_id"][..],
                &["token", "accountId"][..],
                &["token", "account_id"][..],
                &["token", "chatgptAccountId"][..],
                &["token", "chatgpt_account_id"][..],
                &["credentials", "chatgpt_account_id"][..],
                &["providerSpecificData", "chatgptAccountId"][..],
                &["providerSpecificData", "chatgpt_account_id"][..],
                &["meta", "chatgptAccountId"][..],
                &["meta", "chatgpt_account_id"][..],
            ][..],
        ),
        (
            "chatgpt_user_id",
            &[
                &["user", "id"][..],
                &["user_id"][..],
                &["chatgptUserId"][..],
                &["chatgpt_user_id"][..],
                &["tokens", "userId"][..],
                &["tokens", "user_id"][..],
                &["tokens", "chatgptUserId"][..],
                &["tokens", "chatgpt_user_id"][..],
                &["token", "userId"][..],
                &["token", "user_id"][..],
                &["token", "chatgptUserId"][..],
                &["token", "chatgpt_user_id"][..],
                &["credentials", "chatgpt_user_id"][..],
                &["providerSpecificData", "chatgptUserId"][..],
                &["providerSpecificData", "chatgpt_user_id"][..],
            ][..],
        ),
        (
            "email",
            &[
                &["user", "email"][..],
                &["email"][..],
                &["label"][..],
                &["meta", "label"][..],
                &["credentials", "email"][..],
                &["providerSpecificData", "email"][..],
            ][..],
        ),
        (
            "plan_type",
            &[
                &["account", "planType"][..],
                &["account", "plan_type"][..],
                &["planType"][..],
                &["plan_type"][..],
                &["credentials", "plan_type"][..],
                &["providerSpecificData", "chatgptPlanType"][..],
                &["providerSpecificData", "chatgpt_plan_type"][..],
            ][..],
        ),
        (
            "organization_id",
            &[
                &["organizationId"][..],
                &["organization_id"][..],
                &["meta", "organizationId"][..],
                &["meta", "organization_id"][..],
                &["credentials", "organization_id"][..],
                &["providerSpecificData", "organizationId"][..],
                &["providerSpecificData", "organization_id"][..],
            ][..],
        ),
        (
            "expires_at",
            &[
                &["expires"][..],
                &["expiresAt"][..],
                &["expires_at"][..],
                &["expired"][..],
                &["credentials", "expires_at"][..],
            ][..],
        ),
        (
            "workspace_id",
            &[
                &["account", "workspaceId"][..],
                &["account", "workspace_id"][..],
                &["workspaceId"][..],
                &["workspace_id"][..],
                &["meta", "workspaceId"][..],
                &["meta", "workspace_id"][..],
                &["credentials", "workspace_id"][..],
                &["providerSpecificData", "workspaceId"][..],
                &["providerSpecificData", "workspace_id"][..],
            ][..],
        ),
    ] {
        if let Some(value) = first_compatible_json_string(value, paths) {
            token_object.insert(target.to_string(), Value::String(value));
        }
    }
    if value.get("provider").and_then(Value::as_str) == Some("codex") {
        if let Some(id) = first_compatible_json_string(value, &[&["id"]]) {
            token_object
                .entry("account_id".to_string())
                .or_insert(Value::String(id));
        }
    }
    enrich_compatible_token_metadata(&mut token_object);

    let mut auth_object = serde_json::Map::new();
    auth_object.insert("tokens".to_string(), Value::Object(token_object));
    let mut auth = Value::Object(auth_object);

    if crate::auth::token_string(&auth, "access_token").is_none() {
        let client = api_client()?;
        refresh_tokens(&client, &mut auth)?;
    }

    canonicalize_chatgpt_auth(&mut auth)?;
    validate_auth(&auth)?;
    Ok(auth)
}
