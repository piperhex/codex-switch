use super::{
    package,
    state::{self, Record},
    ComputerError, Result, HELPER_ARGUMENT, MCP_SERVER,
};
use std::{
    fs,
    path::{Path, PathBuf},
};
use toml_edit::{value, Array, Table};

const SKILL_NAME: &str = "codex-switch-computer-use";
const MARKER: &str = "<!-- managed:codex-switch-computer-use -->";
const SKILL: &str =
    include_str!("../../resources/codex-switch-computer-use/skills/computer-use/SKILL.md");

fn entry(home: &Path, enabled: bool) -> Result<Table> {
    let executable = std::env::current_exe().map_err(|_| ComputerError::Storage)?;
    let mut table = Table::new();
    table["command"] = value(executable.to_string_lossy().as_ref());
    table["args"] = value(Array::from_iter([format!(
        "{HELPER_ARGUMENT}{}",
        state::home_id(home)
    )]));
    table["enabled"] = value(enabled);
    table["startup_timeout_sec"] = value(30);
    table["tool_timeout_sec"] = value(120);
    Ok(table)
}

fn update(home: &Path, enabled: Option<bool>) -> Result<()> {
    crate::codex_settings::update_managed_mcp(
        home,
        MCP_SERVER,
        &format!("{HELPER_ARGUMENT}{}", state::home_id(home)),
        enabled.map(|enabled| entry(home, enabled)).transpose()?,
    )
    .map_err(|_| ComputerError::Conflict)
}

pub(super) fn configured(home: &Path, enabled: bool) -> Result<bool> {
    crate::codex_settings::managed_mcp_matches(home, MCP_SERVER, &entry(home, enabled)?)
        .map_err(|_| ComputerError::Storage)
}

fn skill_path(home: &Path) -> PathBuf {
    home.join("skills").join(SKILL_NAME).join("SKILL.md")
}

fn check_skill(home: &Path) -> Result<()> {
    let path = skill_path(home);
    match fs::read_to_string(path) {
        Ok(content) if content.contains(MARKER) => Ok(()),
        Ok(_) => Err(ComputerError::Conflict),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(ComputerError::Storage),
    }
}

pub(super) fn skill_matches(home: &Path) -> bool {
    fs::read_to_string(skill_path(home)).is_ok_and(|content| content == SKILL)
}

pub(super) fn install(root: &Path, home: &Path) -> Result<()> {
    install_with(root, home, || package::ensure(root))
}

fn install_with(root: &Path, home: &Path, prepare: impl FnOnce() -> Result<()>) -> Result<()> {
    check_skill(home)?;
    fs::create_dir_all(home).map_err(|_| ComputerError::Storage)?;
    update(home, Some(false))?;
    let mut record = Record {
        home: home.to_owned(),
        enabled: false,
        generation: uuid::Uuid::new_v4().to_string(),
    };
    state::save(root, &record)?;
    prepare()?;
    let skill = skill_path(home);
    fs::create_dir_all(home.join("skills").join(SKILL_NAME)).map_err(|_| ComputerError::Storage)?;
    crate::storage::write_text_atomic(&skill, SKILL).map_err(|_| ComputerError::Storage)?;
    update(home, Some(true))?;
    record.enabled = true;
    state::save(root, &record)
}

pub(super) fn disable(root: &Path, home: &Path, remove: bool) -> Result<()> {
    if let Some(mut record) = state::read(root, &state::home_id(home))? {
        // Revoke before editing config; already-running helpers observe the generation change.
        record.enabled = false;
        record.generation = uuid::Uuid::new_v4().to_string();
        state::save(root, &record)?;
    }
    update(home, if remove { None } else { Some(false) })?;
    let skill = skill_path(home);
    if skill.exists() && check_skill(home).is_ok() {
        fs::remove_file(skill).map_err(|_| ComputerError::Storage)?;
    }
    if remove {
        let record = state::path(root, &state::home_id(home))?;
        if record.exists() {
            fs::remove_file(record).map_err(|_| ComputerError::Storage)?;
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "install_tests.rs"]
mod tests;
