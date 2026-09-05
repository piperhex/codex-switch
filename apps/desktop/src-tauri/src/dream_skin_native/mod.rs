include!("types.rs");
include!("recovery_state.rs");
include!("paths_and_images.rs");
include!("themes.rs");
include!("payload.rs");
include!("speed_selector_overlay.rs");
include!("model_refresh.rs");
include!("cdp.rs");
include!("renderer_bindings.rs");
include!("injection_monitor.rs");
include!("runtime_recovery.rs");
include!("windows_runtime.rs");
include!("macos_runtime.rs");
include!("runtime_lifecycle.rs");
include!("theme_commands.rs");

#[cfg(all(test, target_os = "windows"))]
mod tests_recovery_integration;

#[cfg(test)]
mod tests {
    include!("tests_theme_and_models.rs");
    include!("tests_runtime.rs");
    include!("tests_recovery.rs");
}
