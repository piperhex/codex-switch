static PROVIDER_BALANCE_CACHE: OnceLock<Mutex<HashMap<String, ProviderBalance>>> = OnceLock::new();

fn provider_balance_cache() -> &'static Mutex<HashMap<String, ProviderBalance>> {
    PROVIDER_BALANCE_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cache_provider_balance(provider_id: &str, balance: &ProviderBalance) {
    if let Ok(mut cache) = provider_balance_cache().lock() {
        cache.insert(provider_id.to_string(), balance.clone());
    }
}

fn clear_cached_provider_balance(provider_id: &str) {
    if let Ok(mut cache) = provider_balance_cache().lock() {
        cache.remove(provider_id);
    }
}

pub(crate) fn cached_provider_balance(provider_id: &str) -> Option<ProviderBalance> {
    provider_balance_cache().lock().ok()?.get(provider_id).cloned()
}

fn query_balance_payload(
    client: &Client,
    query_url: &str,
    token: &str,
    user_id: Option<&str>,
    label: &str,
) -> Result<Value, String> {
    if token.is_empty() {
        return Err(format!("{label} query token is empty"));
    }
    let mut request = client.get(query_url).bearer_auth(token);
    if let Some(user_id) = user_id {
        request = request.header("New-Api-User", user_id);
    }
    let response = request
        .send()
        .map_err(|error| format!("{label} query failed: {error}"))?;
    read_balance_response(response, label)
}

fn query_session_balance_payload(
    client: &Client,
    query_url: &str,
    label: &str,
) -> Result<Value, String> {
    let response = client
        .get(query_url)
        .send()
        .map_err(|error| format!("{label} query failed: {error}"))?;
    read_balance_response(response, label)
}

fn read_balance_response(
    response: reqwest::blocking::Response,
    label: &str,
) -> Result<Value, String> {
    read_limited_json_response(response, label, MAX_BALANCE_RESPONSE_BYTES)
}

fn read_limited_json_response(
    response: reqwest::blocking::Response,
    label: &str,
    max_bytes: u64,
) -> Result<Value, String> {
    let status = response.status();
    if !status.is_success() {
        return Err(format!("{label} query returned HTTP {}", status.as_u16()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes)
    {
        return Err(format!("{label} response is too large"));
    }
    let mut bytes = Vec::new();
    response
        .take(max_bytes + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Failed to read {label} response: {error}"))?;
    if bytes.len() as u64 > max_bytes {
        return Err(format!("{label} response is too large"));
    }
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("{label} response is invalid JSON: {error}"))
}

fn new_api_login_url(wallet_url: &str) -> Result<Url, String> {
    let mut url = Url::parse(wallet_url)
        .map_err(|error| format!("New API wallet URL is invalid: {error}"))?;
    url.set_path("/api/user/login");
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

fn json_id(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::to_string)
        .or_else(|| value.as_i64().map(|id| id.to_string()))
        .or_else(|| value.as_u64().map(|id| id.to_string()))
}

struct NewApiLoginAuth {
    access_token: Option<String>,
    user_id: String,
}

fn parse_new_api_login_auth(payload: &Value) -> Result<NewApiLoginAuth, String> {
    if payload.get("success").and_then(Value::as_bool) == Some(false) {
        let message = payload
            .get("message")
            .and_then(Value::as_str)
            .filter(|message| !message.trim().is_empty())
            .unwrap_or("username or password was rejected");
        return Err(format!("New API wallet login failed: {message}"));
    }
    let data = payload
        .get("data")
        .ok_or_else(|| "New API wallet login response is missing data".to_string())?;
    let user = data.get("user").unwrap_or(data);
    let access_token = data
        .get("access_token")
        .or_else(|| data.get("accessToken"))
        .or_else(|| user.get("access_token"))
        .or_else(|| user.get("accessToken"))
        .and_then(Value::as_str)
        .filter(|token| !token.trim().is_empty())
        .map(str::to_string);
    let user_id = user
        .get("id")
        .and_then(json_id)
        .or_else(|| data.get("id").and_then(json_id))
        .ok_or_else(|| "New API wallet login response is missing the user id".to_string())?;
    Ok(NewApiLoginAuth {
        access_token,
        user_id,
    })
}

fn query_new_api_wallet_with_login(
    client: &Client,
    wallet_url: &str,
    username: &str,
    password: &str,
    preferred_wallet_token: Option<&str>,
) -> Result<(f64, String), String> {
    if username.trim().is_empty() || password.is_empty() {
        return Err("New API wallet username or password is empty".to_string());
    }
    let login_url = new_api_login_url(wallet_url)?;
    let response = client
        .post(login_url)
        .json(&json!({ "username": username.trim(), "password": password }))
        .send()
        .map_err(|error| format!("New API wallet login failed: {error}"))?;
    let payload = read_balance_response(response, "New API wallet login")?;
    let auth = parse_new_api_login_auth(&payload)?;
    let mut prior_error = None;
    if let Some(wallet_token) = preferred_wallet_token.filter(|token| !token.trim().is_empty()) {
        match query_balance_payload(
            client,
            wallet_url,
            wallet_token.trim(),
            Some(&auth.user_id),
            "Wallet balance",
        )
        .and_then(|payload| {
            parse_provider_wallet_balance(ProviderBalancePlatform::NewApi, &payload)
        }) {
            Ok(balance) => return Ok(balance),
            Err(error) => prior_error = Some(format!("Wallet token query failed: {error}")),
        }
    }
    if let Some(access_token) = auth
        .access_token
        .as_deref()
        .filter(|token| Some(*token) != preferred_wallet_token)
    {
        match query_balance_payload(
            client,
            wallet_url,
            access_token,
            Some(&auth.user_id),
            "Wallet balance",
        )
        .and_then(|payload| {
            parse_provider_wallet_balance(ProviderBalancePlatform::NewApi, &payload)
        }) {
            Ok(balance) => return Ok(balance),
            Err(error) => prior_error = Some(format!("Login token query failed: {error}")),
        }
    }
    query_session_balance_payload(client, wallet_url, "Wallet balance")
        .and_then(|payload| {
            parse_provider_wallet_balance(ProviderBalancePlatform::NewApi, &payload)
        })
        .map_err(|session_error| match prior_error {
            Some(prior_error) => {
                format!("{prior_error}; session fallback failed: {session_error}")
            }
            None => format!("Session wallet query failed: {session_error}"),
        })
}

fn query_new_api_wallet(
    client: &Client,
    wallet_url: &str,
    wallet_token: Option<&str>,
    username: Option<&str>,
    password: Option<&str>,
) -> Option<Result<(f64, String), String>> {
    match (username, password) {
        (Some(username), Some(password)) => Some(query_new_api_wallet_with_login(
            client,
            wallet_url,
            username,
            password,
            wallet_token,
        )),
        _ => wallet_token
            .filter(|token| !token.trim().is_empty())
            .map(|token| {
                query_balance_payload(client, wallet_url, token.trim(), None, "Wallet balance")
                    .and_then(|payload| {
                        parse_provider_wallet_balance(ProviderBalancePlatform::NewApi, &payload)
                    })
            }),
    }
}
