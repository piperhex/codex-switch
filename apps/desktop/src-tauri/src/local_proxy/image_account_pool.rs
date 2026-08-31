struct ImageAccountPool {
    account_ids: Vec<String>,
    current_index: usize,
}

impl ImageAccountPool {
    fn new(account_ids: Vec<String>) -> Option<Self> {
        (!account_ids.is_empty()).then_some(Self {
            account_ids,
            current_index: 0,
        })
    }

    fn current_account_id(&self) -> &str {
        &self.account_ids[self.current_index]
    }

    fn advance_after_429(&mut self, failed_account_id: &str) -> Option<&str> {
        if self.account_ids.len() < 2 || self.current_account_id() != failed_account_id {
            return None;
        }
        self.current_index = (self.current_index + 1) % self.account_ids.len();
        Some(self.current_account_id())
    }
}

fn official_credential_purpose(path: &str, body: &[u8]) -> OfficialCredentialPurpose {
    if is_image_generation_endpoint(path) {
        return OfficialCredentialPurpose::ImageGeneration;
    }
    if request_contains_input_image(body) {
        return OfficialCredentialPurpose::ImageInput;
    }
    OfficialCredentialPurpose::Default
}

fn image_account_pool_for_request<R: Runtime>(
    app: &tauri::AppHandle<R>,
    path: &str,
    body: &[u8],
    target: &ActiveTarget,
) -> Result<Option<ImageAccountPool>, String> {
    if !matches!(target, ActiveTarget::Official { .. }) {
        return Ok(None);
    }
    let purpose = official_credential_purpose(path, body);
    if purpose == OfficialCredentialPurpose::Default {
        return Ok(None);
    }
    let paths = resolve_paths(app)?;
    let state = try_read_state(&paths)?;
    let preferred = preferred_image_account_id(&state, purpose);
    let enabled_account_ids = if image_account_failover_enabled(&state, purpose) {
        enabled_concurrent_account_ids(&paths, &state)?
    } else {
        Vec::new()
    };
    let account_ids = ordered_image_account_ids(preferred, enabled_account_ids)
        .into_iter()
        .filter(|id| image_account_is_eligible(&paths, id, purpose))
        .collect::<Vec<_>>();
    ImageAccountPool::new(account_ids)
        .map(Some)
        .ok_or_else(|| {
            "No compatible official account is available for this image request".to_string()
        })
}

fn image_account_failover_enabled(
    state: &ManagerStateFile,
    purpose: OfficialCredentialPurpose,
) -> bool {
    if state.concurrent_account_routing_enabled {
        return true;
    }
    let target = match purpose {
        OfficialCredentialPurpose::ImageInput => state.image_input_target.as_ref(),
        OfficialCredentialPurpose::ImageGeneration => state.image_output_target.as_ref(),
        OfficialCredentialPurpose::Default => return false,
    };
    matches!(target, Some(ImageModelTarget::Official { .. }))
        || (purpose == OfficialCredentialPurpose::ImageGeneration
            && state.image_generation_account_id.is_some())
}

fn preferred_image_account_id(
    state: &ManagerStateFile,
    purpose: OfficialCredentialPurpose,
) -> Option<String> {
    let target = match purpose {
        OfficialCredentialPurpose::ImageInput => state.image_input_target.as_ref(),
        OfficialCredentialPurpose::ImageGeneration => state.image_output_target.as_ref(),
        OfficialCredentialPurpose::Default => return None,
    };
    if let Some(ImageModelTarget::Official { account_id }) = target {
        return Some(account_id.clone());
    }
    if purpose == OfficialCredentialPurpose::ImageGeneration {
        if let Some(account_id) = state.image_generation_account_id.as_ref() {
            return Some(account_id.clone());
        }
    }
    state.active_account_id.clone()
}

fn ordered_image_account_ids(
    preferred: Option<String>,
    enabled_account_ids: Vec<String>,
) -> Vec<String> {
    let mut account_ids = Vec::with_capacity(enabled_account_ids.len().saturating_add(1));
    let mut seen = HashSet::new();
    if let Some(preferred) = preferred {
        if seen.insert(preferred.clone()) {
            account_ids.push(preferred);
        }
    }
    for account_id in enabled_account_ids {
        if seen.insert(account_id.clone()) {
            account_ids.push(account_id);
        }
    }
    account_ids
}

fn image_account_is_eligible(
    paths: &Paths,
    account_id: &str,
    purpose: OfficialCredentialPurpose,
) -> bool {
    let Ok(auth) = crate::commands::load_validated_managed_auth(paths, account_id) else {
        return false;
    };
    image_auth_supports_purpose(&auth, purpose)
}

fn image_auth_supports_purpose(auth: &Value, purpose: OfficialCredentialPurpose) -> bool {
    purpose != OfficialCredentialPurpose::ImageGeneration
        || (!is_agent_identity_auth(auth) && token_string(auth, "access_token").is_some())
}

fn advance_image_account_after_429(
    pool: &mut Option<ImageAccountPool>,
    response: &UpstreamPayload,
) {
    if response.status != 429 {
        return;
    }
    let Some(failed_account_id) = response
        .token_usage_account
        .as_ref()
        .map(|account| account.account_id.as_str())
    else {
        return;
    };
    let Some(next_account_id) = pool
        .as_mut()
        .and_then(|pool| pool.advance_after_429(failed_account_id))
    else {
        return;
    };
    eprintln!(
        "image request account failover: failed={failed_account_id}, next={next_account_id}"
    );
}
