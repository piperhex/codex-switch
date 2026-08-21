type NormalizedBalanceSettings = (
    Option<ProviderBalancePlatform>,
    Option<String>,
    Option<String>,
);

type NormalizedWalletSettings = (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
);

fn normalize_balance_settings(
    platform: Option<ProviderBalancePlatform>,
    query_url: Option<String>,
    supplied_token: Option<String>,
    uses_api_key: bool,
    existing: Option<&ProviderProfile>,
) -> Result<NormalizedBalanceSettings, String> {
    let Some(platform) = platform else {
        return Ok((None, None, None));
    };
    let query_url = normalize_balance_query_url(query_url.as_deref().unwrap_or_default())?;
    if platform == ProviderBalancePlatform::DeepSeek {
        validate_deepseek_balance_query_url(&query_url)?;
    }
    let query_token = if uses_api_key {
        None
    } else {
        let supplied = supplied_token.unwrap_or_default().trim().to_string();
        if !supplied.is_empty() {
            Some(supplied)
        } else {
            existing
                .filter(|profile| profile.balance_platform == Some(platform))
                .and_then(|profile| profile.balance_query_token.clone())
                .filter(|token| !token.trim().is_empty())
        }
    };
    if !uses_api_key && query_token.is_none() {
        return Err("Provider balance query token is required".to_string());
    }
    Ok((Some(platform), Some(query_url), query_token))
}

fn normalize_wallet_settings(
    platform: Option<ProviderBalancePlatform>,
    query_url: Option<String>,
    supplied_token: Option<String>,
    supplied_username: Option<String>,
    supplied_password: Option<String>,
    existing: Option<&ProviderProfile>,
) -> Result<NormalizedWalletSettings, String> {
    if platform.is_none() {
        return Ok((None, None, None, None));
    }
    if platform == Some(ProviderBalancePlatform::DeepSeek) {
        return Ok((None, None, None, None));
    }
    let query_url = query_url
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(|value| normalize_balance_query_url(&value))
        .transpose()?;
    let supplied_token = supplied_token.unwrap_or_default().trim().to_string();
    let query_token = if !supplied_token.is_empty() {
        Some(supplied_token)
    } else {
        existing
            .filter(|profile| {
                profile.balance_platform == platform && profile.wallet_query_url == query_url
            })
            .and_then(|profile| profile.wallet_query_token.clone())
            .filter(|token| !token.trim().is_empty())
    };
    if query_token.is_some() && query_url.is_none() {
        return Err("Provider wallet query URL is required when a wallet token is set".to_string());
    }
    let supplied_username = supplied_username.unwrap_or_default().trim().to_string();
    let supplied_password = supplied_password.unwrap_or_default();
    let existing_login = existing
        .filter(|profile| {
            profile.balance_platform == platform && profile.wallet_query_url == query_url
        })
        .map(|profile| {
            (
                profile.wallet_username.clone(),
                profile.wallet_password.clone(),
            )
        })
        .unwrap_or((None, None));
    let (wallet_username, wallet_password) =
        if platform == Some(ProviderBalancePlatform::NewApi) && !supplied_password.is_empty() {
            if supplied_username.is_empty() {
                return Err(
                    "New API wallet username and password must be provided together".to_string(),
                );
            }
            (Some(supplied_username), Some(supplied_password))
        } else if platform == Some(ProviderBalancePlatform::NewApi) {
            if !supplied_username.is_empty()
                && existing_login.0.as_deref() != Some(supplied_username.as_str())
            {
                return Err(
                    "New API wallet password is required when changing the username".to_string(),
                );
            }
            existing_login
        } else {
            (None, None)
        };
    if (wallet_username.is_some() || wallet_password.is_some()) && query_url.is_none() {
        return Err(
            "Provider wallet query URL is required when wallet login is configured".to_string(),
        );
    }
    Ok((query_url, query_token, wallet_username, wallet_password))
}

fn normalize_balance_query_url(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("Provider balance query URL is required".to_string());
    }
    let url = Url::parse(trimmed)
        .map_err(|error| format!("Provider balance query URL is invalid: {error}"))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(
            "Provider balance query URL must be an http:// or https:// URL with a host".to_string(),
        );
    }
    Ok(trimmed.to_string())
}

struct ParsedProviderApiBalance {
    amount: Option<f64>,
    unit: String,
    unlimited: bool,
    embedded_wallet_amount: Option<f64>,
    embedded_wallet_unit: String,
    balance_items: Vec<ProviderBalanceItem>,
}

fn parse_provider_api_balance(
    platform: ProviderBalancePlatform,
    payload: &Value,
) -> Result<ParsedProviderApiBalance, String> {
    let (amount, unit, unlimited, embedded_wallet_amount, embedded_wallet_unit, balance_items) =
        match platform {
            ProviderBalancePlatform::NewApi => {
                let data = payload
                    .get("data")
                    .ok_or_else(|| "New API balance response is missing data".to_string())?;
                let unlimited = data
                    .get("unlimited_quota")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let available = data
                    .get("total_available")
                    .and_then(Value::as_f64)
                    .ok_or_else(|| {
                        "New API balance response is missing data.total_available".to_string()
                    })?;
                (
                    (!unlimited).then_some((available / NEW_API_QUOTA_PER_USD).max(0.0)),
                    "USD".to_string(),
                    unlimited,
                    None,
                    "USD".to_string(),
                    Vec::new(),
                )
            }
            ProviderBalancePlatform::Sub2Api => {
                let mode = payload.get("mode").and_then(Value::as_str);
                let remaining = payload
                    .get("remaining")
                    .and_then(Value::as_f64)
                    .or_else(|| {
                        payload
                            .get("quota")
                            .and_then(|quota| quota.get("remaining"))
                            .and_then(Value::as_f64)
                    })
                    .ok_or_else(|| "Sub2API balance response is missing remaining".to_string())?;
                let embedded_wallet_amount = payload.get("balance").and_then(Value::as_f64);
                let is_wallet_mode =
                    mode == Some("unrestricted") && embedded_wallet_amount.is_some();
                let unlimited = is_wallet_mode || remaining < 0.0;
                (
                    (!unlimited).then_some(remaining.max(0.0)),
                    payload
                        .get("unit")
                        .and_then(Value::as_str)
                        .unwrap_or("USD")
                        .to_string(),
                    unlimited,
                    embedded_wallet_amount,
                    payload
                        .get("unit")
                        .and_then(Value::as_str)
                        .unwrap_or("USD")
                        .to_string(),
                    Vec::new(),
                )
            }
            ProviderBalancePlatform::DeepSeek => {
                let available = payload
                    .get("is_available")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let mut balance_items = Vec::new();
                for item in payload
                    .get("balance_infos")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                {
                    let unit = item
                        .get("currency")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|unit| !unit.is_empty())
                        .unwrap_or("CNY")
                        .to_string();
                    let amount =
                        item.get("total_balance")
                            .and_then(json_number)
                            .ok_or_else(|| {
                                "DeepSeek balance response contains an invalid total_balance"
                                    .to_string()
                            })?;
                    balance_items.push(ProviderBalanceItem { amount, unit });
                }
                if available && balance_items.is_empty() {
                    return Err("DeepSeek balance response is missing balance_infos".to_string());
                }
                let primary = balance_items.first();
                (
                    primary.map(|item| item.amount),
                    primary
                        .map(|item| item.unit.clone())
                        .unwrap_or_else(|| "CNY".to_string()),
                    !available,
                    None,
                    "CNY".to_string(),
                    balance_items,
                )
            }
        };
    Ok(ParsedProviderApiBalance {
        amount,
        unit,
        unlimited,
        embedded_wallet_amount,
        embedded_wallet_unit,
        balance_items,
    })
}

fn json_number(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|value| value.trim().parse().ok()))
}

fn parse_deepseek_models(payload: &Value) -> Result<Vec<String>, String> {
    let data = payload
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| "DeepSeek model response is missing data".to_string())?;
    let mut models = Vec::new();
    for item in data {
        if let Some(model) = item
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|model| !model.is_empty())
        {
            push_model_once(&mut models, model.to_string());
        }
    }
    if models.is_empty() {
        Err("DeepSeek did not return any available models".to_string())
    } else {
        Ok(models)
    }
}

pub(crate) fn deepseek_endpoint_url(base_url: &str, endpoint: &str) -> Result<Url, String> {
    let mut url =
        Url::parse(base_url).map_err(|error| format!("DeepSeek Base URL is invalid: {error}"))?;
    if url.scheme() != "https"
        || url.host_str() != Some("api.deepseek.com")
        || url.port_or_known_default() != Some(443)
    {
        return Err(
            "DeepSeek Base URL must use the official https://api.deepseek.com endpoint".to_string(),
        );
    }
    let mut path = url.path().trim_end_matches('/').to_string();
    if !path.is_empty() && path != "/v1" {
        return Err(
            "DeepSeek Base URL must use the official https://api.deepseek.com endpoint".to_string(),
        );
    }
    if path.ends_with("/v1") {
        path.truncate(path.len() - 3);
    }
    url.set_path(&format!(
        "{}/{}",
        path.trim_end_matches('/'),
        endpoint.trim_start_matches('/')
    ));
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

fn validate_deepseek_balance_query_url(value: &str) -> Result<(), String> {
    let expected = deepseek_endpoint_url("https://api.deepseek.com", "/user/balance")?;
    let actual = Url::parse(value)
        .map_err(|error| format!("Provider balance query URL is invalid: {error}"))?;
    if actual == expected {
        Ok(())
    } else {
        Err("DeepSeek balance queries must use the official endpoint".to_string())
    }
}

fn parse_provider_wallet_balance(
    platform: ProviderBalancePlatform,
    payload: &Value,
) -> Result<(f64, String), String> {
    match platform {
        ProviderBalancePlatform::NewApi => {
            let quota = payload
                .get("data")
                .and_then(|data| data.get("quota"))
                .and_then(Value::as_f64)
                .ok_or_else(|| "New API wallet response is missing data.quota".to_string())?;
            Ok(((quota / NEW_API_QUOTA_PER_USD).max(0.0), "USD".to_string()))
        }
        ProviderBalancePlatform::Sub2Api => {
            let balance = payload
                .get("data")
                .and_then(|data| data.get("balance"))
                .and_then(Value::as_f64)
                .ok_or_else(|| "Sub2API wallet response is missing data.balance".to_string())?;
            Ok((balance.max(0.0), "USD".to_string()))
        }
        ProviderBalancePlatform::DeepSeek => {
            Err("DeepSeek does not use a separate wallet balance endpoint".to_string())
        }
    }
}
