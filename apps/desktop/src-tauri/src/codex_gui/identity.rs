use serde_json::{json, Value};

// Match interactive `codex`, which initializes app-server as codex-tui and
// includes the installed CLI version in its User-Agent suffix.
pub(super) const CLI_ORIGINATOR: &str = "codex-tui";

pub(super) fn initialize_params(cli_version: &str) -> Value {
    json!({
        "clientInfo": {
            "name": CLI_ORIGINATOR,
            "title": "Codex Switch",
            "version": cli_version
        },
        "capabilities": {"experimentalApi": true}
    })
}
