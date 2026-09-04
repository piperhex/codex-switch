const MAX_CODEX_NOTIFICATION_CHARS: usize = 500;

fn normalize_notification(message: String) -> Option<String> {
    let message = message.trim();
    if message.is_empty() {
        return None;
    }
    Some(message.chars().take(MAX_CODEX_NOTIFICATION_CHARS).collect())
}

/// Mirrors a Codex Switch toast into the managed Codex renderer when its local
/// CDP channel is available. Notification delivery is deliberately best-effort.
#[tauri::command]
pub(crate) async fn sync_codex_notification(message: String) -> Result<bool, String> {
    let Some(message) = normalize_notification(message) else {
        return Ok(false);
    };
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        tauri::async_runtime::spawn_blocking(move || {
            crate::dream_skin_native::show_codex_notification(&message)
        })
        .await
        .map_err(|_| "Could not sync the notification to Codex.".to_string())?
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = message;
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notification_text_is_trimmed_and_bounded() {
        assert_eq!(
            normalize_notification("  ready  ".to_string()).as_deref(),
            Some("ready")
        );
        assert_eq!(normalize_notification(" \n ".to_string()), None);
        assert_eq!(
            normalize_notification("好".repeat(MAX_CODEX_NOTIFICATION_CHARS + 2))
                .expect("notification should remain present")
                .chars()
                .count(),
            MAX_CODEX_NOTIFICATION_CHARS
        );
    }
}
