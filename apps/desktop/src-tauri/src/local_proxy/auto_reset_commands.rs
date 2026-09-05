use crate::models::AutoResetSettings;

#[tauri::command]
pub(crate) async fn get_auto_reset_settings<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<AutoResetSettings, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(try_read_state(&resolve_paths(&app)?)?.auto_reset)
    })
    .await
    .map_err(|_| "读取自动重置卡设置失败".to_string())?
}

#[tauri::command]
pub(crate) async fn set_auto_reset_settings<R: Runtime>(
    app: tauri::AppHandle<R>,
    mut settings: AutoResetSettings,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        settings.validate()?;
        let paths = resolve_paths(&app)?;
        if let Some(ids) = settings.account_ids.as_mut() {
            ids.sort();
            ids.dedup();
            for id in ids {
                crate::commands::load_validated_managed_auth(&paths, id)
                    .map_err(|_| "所选账户已不可用，请重新选择".to_string())?;
            }
        }
        update_state(&paths, |state| {
            state.auto_reset = settings;
            state.auto_reset_settings_changed = true;
            Ok(())
        })?;
        app.emit("providers-changed", ())
            .map_err(|_| "更新设置显示失败".to_string())
    })
    .await
    .map_err(|_| "保存自动重置卡设置失败".to_string())?
}
