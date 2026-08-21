fn extract_compatible_json_tokens(value: &Value, depth: usize) -> Option<CompatibleJsonAuthTokens> {
    if depth > 4 {
        return None;
    }

    let tokens = CompatibleJsonAuthTokens {
        id_token: first_compatible_json_string(
            value,
            &[
                &["id_token"],
                &["idToken"],
                &["tokens", "id_token"],
                &["tokens", "idToken"],
                &["token", "id_token"],
                &["token", "idToken"],
                &["credentials", "id_token"],
                &["credentials", "idToken"],
            ],
        ),
        access_token: first_compatible_json_string(
            value,
            &[
                &["access_token"],
                &["accessToken"],
                &["tokens", "access_token"],
                &["tokens", "accessToken"],
                &["token", "access_token"],
                &["token", "accessToken"],
                &["credentials", "access_token"],
                &["credentials", "accessToken"],
            ],
        ),
        refresh_token: first_compatible_json_string(
            value,
            &[
                &["refresh_token"],
                &["refreshToken"],
                &["tokens", "refresh_token"],
                &["tokens", "refreshToken"],
                &["token", "refresh_token"],
                &["token", "refreshToken"],
                &["credentials", "refresh_token"],
                &["credentials", "refreshToken"],
            ],
        ),
        session_token: first_compatible_json_string(
            value,
            &[
                &["session_token"],
                &["sessionToken"],
                &["tokens", "session_token"],
                &["tokens", "sessionToken"],
                &["token", "session_token"],
                &["token", "sessionToken"],
                &["credentials", "session_token"],
            ],
        ),
    };
    if tokens.has_any() {
        return Some(tokens);
    }

    let object = value.as_object()?;
    for key in [
        "auth",
        "auth_json",
        "authJson",
        "session",
        "session_json",
        "sessionJson",
    ] {
        let Some(nested) = object.get(key) else {
            continue;
        };
        match nested {
            Value::Object(_) => {
                if let Some(tokens) = extract_compatible_json_tokens(nested, depth + 1) {
                    return Some(tokens);
                }
            }
            Value::String(raw) => {
                let parsed = serde_json::from_str::<Value>(raw).ok()?;
                if let Some(tokens) = extract_compatible_json_tokens(&parsed, depth + 1) {
                    return Some(tokens);
                }
            }
            _ => {}
        }
    }
    None
}

fn first_compatible_json_string(value: &Value, paths: &[&[&str]]) -> Option<String> {
    paths.iter().find_map(|path| {
        let mut current = value;
        for key in *path {
            current = current.get(*key)?;
        }
        current
            .as_str()
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(ToOwned::to_owned)
    })
}

fn enrich_compatible_token_metadata(tokens: &mut serde_json::Map<String, Value>) {
    let token = tokens
        .get("id_token")
        .or_else(|| tokens.get("access_token"))
        .and_then(Value::as_str)
        .and_then(|token| crate::auth::decode_jwt(token).ok());
    let Some(claims) = token else {
        return;
    };
    let nested = claims
        .get("https://api.openai.com/auth")
        .and_then(Value::as_object);
    let profile = claims
        .get("https://api.openai.com/profile")
        .and_then(Value::as_object);
    for (target, value) in [
        (
            "account_id",
            nested.and_then(|value| value.get("chatgpt_account_id")),
        ),
        (
            "chatgpt_user_id",
            nested
                .and_then(|value| {
                    value
                        .get("chatgpt_user_id")
                        .or_else(|| value.get("user_id"))
                })
                .or_else(|| claims.get("sub")),
        ),
        (
            "email",
            claims
                .get("email")
                .or_else(|| profile.and_then(|value| value.get("email"))),
        ),
        (
            "plan_type",
            nested.and_then(|value| value.get("chatgpt_plan_type")),
        ),
        (
            "organization_id",
            nested
                .and_then(|value| value.get("organization_id"))
                .or_else(|| {
                    nested?
                        .get("organizations")?
                        .as_array()?
                        .iter()
                        .find_map(|value| value.get("id"))
                }),
        ),
        ("workspace_id", claims.get("workspace_id")),
    ] {
        if !tokens.contains_key(target) {
            if let Some(value) = value
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
            {
                tokens.insert(target.to_string(), Value::String(value.to_string()));
            }
        }
    }
}

fn compatible_json_account_metadata(value: &Value) -> CompatibleJsonAccountMetadata {
    let note = first_compatible_json_string(
        value,
        &[
            &["account_note"],
            &["accountInfo"],
            &["account_info"],
            &["note"],
            &["notes"],
            &["remark"],
        ],
    );
    let expires_at = compatible_json_expiration(value);
    let auto_switch_priority = value
        .get("priority")
        .and_then(Value::as_i64)
        .and_then(|priority| i32::try_from(priority).ok());
    let disabled = value.get("disabled").and_then(Value::as_bool).or_else(|| {
        value
            .get("isActive")
            .and_then(Value::as_bool)
            .map(|active| !active)
    });
    CompatibleJsonAccountMetadata {
        note,
        expires_at,
        auto_switch_priority,
        disabled,
    }
}

fn compatible_json_expiration(value: &Value) -> Option<String> {
    for path in [
        &["expires"][..],
        &["expiresAt"][..],
        &["expires_at"][..],
        &["expired"][..],
        &["credentials", "expires_at"][..],
    ] {
        let mut current = value;
        let mut present = true;
        for key in path {
            let Some(nested) = current.get(*key) else {
                present = false;
                break;
            };
            current = nested;
        }
        if present {
            if let Some(date) = normalize_compatible_expiration(current) {
                return Some(date);
            }
        }
    }
    for token in [
        first_compatible_json_string(
            value,
            &[
                &["access_token"],
                &["accessToken"],
                &["tokens", "access_token"],
                &["tokens", "accessToken"],
                &["token", "access_token"],
                &["token", "accessToken"],
                &["credentials", "access_token"],
                &["credentials", "accessToken"],
            ],
        ),
        first_compatible_json_string(
            value,
            &[
                &["id_token"],
                &["idToken"],
                &["tokens", "id_token"],
                &["tokens", "idToken"],
                &["token", "id_token"],
                &["token", "idToken"],
                &["credentials", "id_token"],
                &["credentials", "idToken"],
            ],
        ),
    ]
    .into_iter()
    .flatten()
    {
        if let Ok(claims) = crate::auth::decode_jwt(&token) {
            if let Some(exp) = claims.get("exp").and_then(Value::as_i64) {
                return Utc
                    .timestamp_opt(exp, 0)
                    .single()
                    .map(|date| date.date_naive().to_string());
            }
        }
    }
    None
}

fn normalize_compatible_expiration(value: &Value) -> Option<String> {
    if let Some(number) = value.as_i64() {
        let seconds = if number > 100_000_000_000 {
            number / 1000
        } else {
            number
        };
        return Utc
            .timestamp_opt(seconds, 0)
            .single()
            .map(|date| date.date_naive().to_string());
    }
    let raw = value.as_str()?.trim();
    if let Ok(number) = raw.parse::<i64>() {
        let seconds = if number > 100_000_000_000 {
            number / 1000
        } else {
            number
        };
        return Utc
            .timestamp_opt(seconds, 0)
            .single()
            .map(|date| date.date_naive().to_string());
    }
    if let Ok(date) = NaiveDate::parse_from_str(raw, "%Y-%m-%d") {
        return Some(date.to_string());
    }
    chrono::DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|date| date.date_naive().to_string())
}
