fn dispatch_gui_command(app: AppHandle, command: &str, args: Value) -> Result<Value, String> {
    use crate::codex_gui::{self, GuiState};
    use tauri::Manager;

    match command {
        "codex_gui_git" => serialize(block_on(codex_gui::git::codex_gui_git(
            app.clone(), app.state::<codex_gui::git::GitState>(), argument(&args, "request")?,
        ))),
        "codex_gui_undo" => serialize(block_on(codex_gui::undo::codex_gui_undo(
            app.clone(), app.state::<GuiState>(), argument(&args, "request")?,
        ))),
        "codex_gui_delete_thread" => serialize(block_on(codex_gui::deletion::codex_gui_delete_thread(
            app.clone(), app.state::<GuiState>(), argument(&args, "threadId")?,
        ))),
        "codex_gui_connect" => serialize(block_on(codex_gui::connect_web(
            app.clone(), app.state::<GuiState>(), argument(&args, "reuseExisting")?,
        ))),
        "codex_gui_request" => serialize(block_on(codex_gui::codex_gui_request(
            app.state::<GuiState>(), argument(&args, "request")?,
        ))),
        "codex_gui_respond" => serialize(block_on(codex_gui::codex_gui_respond(
            app.state::<GuiState>(), argument(&args, "reply")?,
        ))),
        "codex_gui_events" => serialize(codex_gui::web::poll(&app, argument(&args, "cursor")?)),
        "codex_gui_usage_summary" => serialize(block_on(codex_gui::usage::codex_gui_usage_summary(app))),
        _ => dispatch_extended_command(app, command, args),
    }
}
