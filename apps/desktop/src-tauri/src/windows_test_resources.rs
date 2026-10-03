// Both test harnesses need Tauri's Common-Controls v6 manifest before Windows
// resolves rfd's TaskDialogIndirect import. Keep this link test-only: Tauri
// already links resource.lib into the application binary.
#[link(name = "resource.lib", kind = "static", modifiers = "+verbatim")]
extern "C" {}
