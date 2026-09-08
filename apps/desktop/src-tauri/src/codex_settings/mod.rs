pub(crate) mod commands;
mod document;
mod error;
mod managed;
mod models;
mod patch;
mod persistence;

pub(crate) use commands::{
    patch_codex_config_document, read_codex_config_document, save_codex_config_document,
    validate_codex_config_document,
};
pub(crate) use managed::{managed_mcp_matches, update_managed_mcp};

#[cfg(test)]
mod tests;
