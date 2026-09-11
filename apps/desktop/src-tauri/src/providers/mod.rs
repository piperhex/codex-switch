mod catalog_storage;
mod reasoning_defaults;
use reasoning_defaults::known_model_reasoning_efforts;

include!("model_refresh.rs");
include!("config_repair.rs");
include!("provider_commands.rs");
include!("balance_queries.rs");
include!("activation.rs");
include!("proxy_state.rs");
include!("groups_and_storage.rs");
include!("balance_normalization.rs");
include!("codex_switch_balance.rs");
include!("profile_normalization.rs");
include!("proxy_config.rs");
include!("model_catalog.rs");

#[cfg(test)]
mod tests {
    include!("tests/common.rs");
    include!("tests/balance.rs");
    include!("tests/codex_switch_balance.rs");
    include!("tests/auth_refresh.rs");
    include!("tests/proxy_config.rs");
    include!("tests/presets.rs");
    include!("tests/model_catalog.rs");
    include!("tests/catalog_storage.rs");
    include!("tests/model_refresh.rs");
    include!("tests/reasoning_defaults.rs");
    include!("tests/config_repair.rs");
}
