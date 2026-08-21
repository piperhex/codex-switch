include!("model_refresh.rs");
include!("provider_commands.rs");
include!("balance_queries.rs");
include!("activation.rs");
include!("proxy_state.rs");
include!("groups_and_storage.rs");
include!("balance_normalization.rs");
include!("profile_normalization.rs");
include!("proxy_config.rs");
include!("model_catalog.rs");

#[cfg(test)]
mod tests {
    include!("tests/common.rs");
    include!("tests/balance.rs");
    include!("tests/proxy_config.rs");
    include!("tests/presets.rs");
    include!("tests/model_catalog.rs");
}
