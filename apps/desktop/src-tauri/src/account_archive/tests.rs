#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ProviderApiFormat, ProviderKind};
    use serde_json::json;

    #[test]
    fn archive_keeps_payload_encrypted_inside_plain_zip() {
        let payload = AccountArchivePayload {
            format_version: 2,
            exported_at: "2026-07-04T00:00:00Z".to_string(),
            active_account_id: Some("account-1".to_string()),
            active_provider_id: Some("provider-1".to_string()),
            accounts: vec![AccountArchiveEntry {
                id: "account-1".to_string(),
                auth: json!({
                    "tokens": {
                        "access_token": "plain-secret-access-token",
                    }
                }),
                note: "plain-secret-note".to_string(),
                expires_at: "2026-12-31".to_string(),
                private_details: AccountPrivateDetails {
                    password: "plain-secret-password".to_string(),
                    phone_number: "+65 6123 4567".to_string(),
                    totp_secret: "JBSWY3DPEHPK3PXP".to_string(),
                },
                usage: UsageSummary::default(),
                auto_switch_priority: 0,
                auto_switch_threshold: 0.0,
                last_modified_at: Some("2026-07-04T00:00:00Z".to_string()),
            }],
            providers: vec![ProviderSyncPayload {
                id: "provider-1".to_string(),
                kind: ProviderKind::Custom,
                name: "Gateway".to_string(),
                group: String::new(),
                base_url: "https://gateway.example.com/v1".to_string(),
                api_key: "plain-secret-provider-key".to_string(),
                model: "gpt-4.1".to_string(),
                models: vec!["gpt-4.1".to_string()],
                model_reasoning_efforts: Default::default(),
                model_context_windows: Default::default(),
                model_api_formats: Default::default(),
                image_input_models: vec!["gpt-4.1".to_string()],
                context_window: None,
                model_selection_controlled_by_codex: false,
                api_format: ProviderApiFormat::OpenaiResponses,
                balance_platform: None,
                balance_query_url: None,
                balance_query_token: None,
                wallet_query_url: None,
                wallet_query_token: None,
                wallet_username: None,
                wallet_password: None,
                last_modified_at: "2026-07-04T00:00:00Z".to_string(),
                field_modified_at: Default::default(),
            }],
        };

        let archive = encode_archive(&payload).expect("archive should encode");
        let archive_text = String::from_utf8_lossy(&archive);
        assert!(archive_text.contains(ARCHIVE_PAYLOAD_FILE));
        assert!(!archive_text.contains("plain-secret-access-token"));
        assert!(!archive_text.contains("plain-secret-provider-key"));
        assert!(!archive_text.contains("plain-secret-note"));
        assert!(!archive_text.contains("plain-secret-password"));

        let mut zip = ZipArchive::new(Cursor::new(archive)).expect("archive should be a plain zip");
        let mut encrypted = Vec::new();
        zip.by_name(ARCHIVE_PAYLOAD_FILE)
            .expect("zip should contain encrypted payload file")
            .read_to_end(&mut encrypted)
            .expect("payload should read");
        assert!(encrypted.starts_with(ARCHIVE_MAGIC));
        assert!(!String::from_utf8_lossy(&encrypted).contains("plain-secret-note"));
        assert!(!String::from_utf8_lossy(&encrypted).contains("plain-secret-provider-key"));
        assert!(!String::from_utf8_lossy(&encrypted).contains("plain-secret-password"));

        let compressed = decrypt_payload(&encrypted).expect("payload should decrypt");
        let json = gunzip(&compressed).expect("payload should decompress");
        let restored: AccountArchivePayload =
            serde_json::from_slice(&json).expect("payload should decode");
        assert_eq!(restored.accounts[0].note, "plain-secret-note");
        assert_eq!(
            restored.accounts[0].private_details.password,
            "plain-secret-password"
        );
        assert_eq!(restored.providers[0].api_key, "plain-secret-provider-key");
    }
}
