fn collect_accounts<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<AccountArchivePayload, String> {
    let paths = resolve_paths(app)?;
    let state = read_state(&paths);
    let active_account_id = state.active_account_id;
    let active_provider_id = state.active_provider_id;
    let mut accounts = Vec::new();
    if paths.accounts.exists() {
        for entry in fs::read_dir(&paths.accounts)
            .map_err(|error| format!("Failed to read account store: {error}"))?
        {
            let entry = entry.map_err(|error| error.to_string())?;
            if !entry.path().is_dir() {
                continue;
            }
            let auth_path = entry.path().join("auth.json");
            if !auth_path.exists() {
                continue;
            }
            let mut auth = read_json(&auth_path)?;
            let repaired = canonicalize_chatgpt_auth(&mut auth)?;
            validate_auth(&auth)?;
            let (_, _, _, id) = account_fields(&auth)?;
            if repaired {
                write_managed_auth_if_changed(&paths, &id, &auth)?;
            }
            let last_modified_at = Some(load_or_init_last_modified(&paths, &id)?.to_rfc3339());
            accounts.push(AccountArchiveEntry {
                note: load_note(&note_path(&paths, &id)),
                expires_at: load_expiration(&expiration_path(&paths, &id)),
                private_details: load_account_private_details(&account_private_details_path(
                    &paths, &id,
                )),
                usage: load_usage(&usage_path(&paths, &id)),
                auto_switch_priority: load_auto_switch_priority(&auto_switch_priority_path(
                    &paths, &id,
                )),
                last_modified_at,
                id,
                auth,
            });
        }
    }
    accounts.sort_by(|left, right| left.id.cmp(&right.id));
    let providers = collect_providers(&paths)?;
    Ok(AccountArchivePayload {
        format_version: 4,
        exported_at: Utc::now().to_rfc3339(),
        active_account_id,
        active_provider_id,
        accounts,
        providers,
    })
}

fn apply_archive<R: Runtime>(
    app: &tauri::AppHandle<R>,
    payload: AccountArchivePayload,
) -> Result<AccountArchiveImportResult, String> {
    if payload.format_version == 0 || payload.format_version > 4 {
        return Err(format!(
            "Unsupported account archive version: {}",
            payload.format_version
        ));
    }
    if payload.accounts.is_empty() && payload.providers.is_empty() {
        return Err("The selected archive does not contain any accounts or providers".to_string());
    }

    let paths = resolve_paths(app)?;
    fs::create_dir_all(&paths.accounts)
        .map_err(|error| format!("Failed to create account store: {error}"))?;
    fs::create_dir_all(&paths.providers)
        .map_err(|error| format!("Failed to create provider store: {error}"))?;

    let mut validated_accounts = Vec::new();
    for mut account in payload.accounts {
        canonicalize_chatgpt_auth(&mut account.auth)?;
        validate_auth(&account.auth)?;
        let (_, _, _, computed_id) = account_fields(&account.auth)?;
        if computed_id != account.id {
            return Err(format!(
                "Archive account {} does not match its auth.json identity",
                account.id
            ));
        }
        validated_accounts.push(account);
    }

    let mut account_ids = Vec::new();
    let mut active_account: Option<(String, Value)> = None;
    for account in validated_accounts {
        let auth_path = managed_auth_path(&paths, &account.id);
        let local_auth = read_json(&auth_path).ok();
        let local_usable = local_auth.as_ref().is_some_and(|auth| {
            validate_auth(auth).is_ok()
                && matches!(account_fields(auth), Ok((_, _, _, local_id)) if local_id == account.id)
        });
        let local_modified_at = if local_usable {
            Some(load_or_init_last_modified(&paths, &account.id)?)
        } else {
            None
        };
        let archive_modified_at = account
            .last_modified_at
            .as_deref()
            .and_then(parse_last_modified);
        let should_apply_archive = !local_usable
            || match (local_modified_at.as_ref(), archive_modified_at.as_ref()) {
                (Some(local), Some(archive)) => archive > local,
                (None, _) => true,
                (Some(_), None) => false,
            };
        let account_auth = if should_apply_archive {
            write_json_if_changed(&auth_path, &account.auth)?;
            save_note(&note_path(&paths, &account.id), &account.note)?;
            save_expiration(&expiration_path(&paths, &account.id), &account.expires_at)?;
            save_account_private_details(
                &account_private_details_path(&paths, &account.id),
                &account.private_details,
            )?;
            save_usage(&usage_path(&paths, &account.id), &account.usage)?;
            save_auto_switch_priority(
                &auto_switch_priority_path(&paths, &account.id),
                account.auto_switch_priority,
            )?;
            save_account_last_modified(
                &paths,
                &account.id,
                archive_modified_at.unwrap_or_else(Utc::now),
            )?;
            account.auth.clone()
        } else {
            local_auth.unwrap_or_else(|| account.auth.clone())
        };

        if payload.active_account_id.as_deref() == Some(&account.id) {
            active_account = Some((account.id.clone(), account_auth));
        }
        if !account_ids.contains(&account.id) {
            account_ids.push(account.id);
        }
    }

    let active_account_id = if let Some((id, auth)) = active_account {
        let can_activate = crate::local_proxy::is_running()
            || crate::commands::sync_current_auth_if_client_stopped(&paths, &auth)?;
        if !can_activate {
            None
        } else {
            let mut state = read_state(&paths);
            state.active_account_id = Some(id.clone());
            write_state(&paths, &state)?;
            if crate::local_proxy::is_running() {
                crate::providers::apply_local_proxy_config_for_paths(&paths)?;
            }
            Some(id)
        }
    } else {
        None
    };

    let mut provider_ids = Vec::new();
    for provider in payload.providers {
        let profile = provider_payload_to_profile(&provider)?;
        let local_profile = crate::providers::read_provider(&paths, &provider.id).ok();
        let local_modified_at = local_profile
            .as_ref()
            .and_then(|_| crate::providers::provider_modified_at(&paths, &provider.id).ok());
        let archive_modified_at = parse_last_modified(&provider.last_modified_at);
        let should_apply_archive = local_profile.is_none()
            || match (local_modified_at.as_ref(), archive_modified_at.as_ref()) {
                (Some(local), Some(archive)) => archive > local,
                (None, _) => true,
                (Some(_), None) => false,
            };

        if should_apply_archive {
            crate::providers::write_synced_provider(&paths, profile, &provider.field_modified_at)?;
        }
        if !provider_ids.contains(&provider.id) {
            provider_ids.push(provider.id);
        }
    }

    let active_provider_id = if let Some(id) = payload.active_provider_id.as_deref() {
        if provider_ids.iter().any(|provider_id| provider_id == id)
            && crate::providers::activate_provider_for_sync(&paths, id)?
        {
            Some(id.to_string())
        } else {
            None
        }
    } else {
        None
    };

    Ok(AccountArchiveImportResult {
        imported: account_ids.len(),
        account_ids,
        active_account_id,
        providers_imported: provider_ids.len(),
        provider_ids,
        active_provider_id,
    })
}
