use std::path::Path;
use toml_edit::{Item, Table};

use super::{document, error::ConfigError, models::SaveConfigRequest, persistence};

/// Read a managed entry through the same serialized configuration access used by the editor.
pub(crate) fn managed_mcp_matches(
    home: &Path,
    name: &str,
    expected: &Table,
) -> Result<bool, String> {
    persistence::with_current_config(home, |path| {
        let current = persistence::read(path)?;
        let document = document::parse(&current.content)?;
        let Some(existing) = document
            .get("mcp_servers")
            .and_then(|servers| servers.get(name))
        else {
            return Ok(false);
        };
        let mut expected_document = toml_edit::DocumentMut::new();
        expected_document["entry"] = Item::Table(expected.clone());
        let mut actual_document = toml_edit::DocumentMut::new();
        actual_document["entry"] = existing.clone();
        let expected_values = document::values(&expected_document)?;
        let actual_values = document::values(&actual_document)?;
        Ok(expected
            .iter()
            .all(|(key, _)| actual_values["entry"][key] == expected_values["entry"][key]))
    })
    .map_err(|error| error.to_string())
}

/// Update only an MCP entry carrying the caller's exact managed argument, preserving other settings.
pub(crate) fn update_managed_mcp(
    home: &Path,
    name: &str,
    managed_argument: &str,
    replacement: Option<Table>,
) -> Result<(), String> {
    persistence::with_current_config(home, |path| {
        let current = persistence::read(path)?;
        let mut document = document::parse(&current.content)?;
        if let Some(existing) = document
            .get("mcp_servers")
            .and_then(|servers| servers.get(name))
        {
            let owned = existing
                .get("args")
                .and_then(Item::as_array)
                .is_some_and(|args| {
                    args.iter()
                        .any(|arg| arg.as_str() == Some(managed_argument))
                });
            if !owned {
                return Err(ConfigError::Conflict);
            }
        }
        if document.get("mcp_servers").is_none() && replacement.is_some() {
            document["mcp_servers"] = Item::Table(Table::new());
        }
        if let Some(servers) = document.get_mut("mcp_servers") {
            let servers = servers
                .as_table_like_mut()
                .ok_or(ConfigError::InvalidValue)?;
            match replacement {
                Some(table) => {
                    servers.insert(name, Item::Table(table));
                }
                None => {
                    servers.remove(name);
                }
            }
        }
        persistence::save(
            path,
            SaveConfigRequest {
                content: document.to_string(),
                expected_revision: current.revision,
            },
        )?;
        Ok(())
    })
    .map_err(|error| error.to_string())
}
