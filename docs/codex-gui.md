# Codex GUI

Codex GUI is the local chat workspace embedded in Codex Switch. Its navigation entry appears immediately after
Providers (三方模型及中转). It supports project folders, text and image input, model and reasoning selection,
streamed Markdown replies, command output, file diffs, plans, permission approvals, questions, interruption,
history, search, renaming, pinning, and archiving/restoring conversations.

Selecting a project is optional. Hovering a selected folder reveals a removal button on its left; removing
the selection leaves the actual folder intact and applies to the next message. Project changes are disabled
while a turn is running. Projectless conversations appear under the “无项目” group.

## Installation and storage

The first visit offers a download from [official Codex Releases](https://github.com/openai/codex/releases).
Nothing is installed until the user clicks the download button. The installer chooses the current platform's
complete `codex-package` archive, checks its size and GitHub SHA-256 digest, extracts into a staging directory,
and activates the version only after successful extraction. Updates retain earlier version directories.
The app's network proxy settings also apply to the download.

Both the executable and the conversation data live under the Tauri application data directory (`dev.codex.switch`):

```text
dev.codex.switch/
├── codex-cli/
│   ├── installed.json
│   └── <version>/
│       ├── bin/codex[.exe]
│       ├── codex-resources/
│       └── codex-path/
├── codex-gui-workspaces/     # Separate scratch folders for projectless conversations
└── .codex/
    ├── config.toml
    ├── auth.json
    ├── sessions/
    ├── archived_sessions/
    ├── state_*.sqlite
    └── log/
```

On Windows this normally resolves to `%APPDATA%/dev.codex.switch`. Only the currently selected account's
authentication and Codex configuration are imported. Official conversation files, indexes, and databases are
never imported or edited. SQLite and log locations are overridden on the private process command line, even
if the imported configuration specifies other locations. Reconnect after switching accounts or configuration.
Recent folders, pins, and per-conversation project choices are UI preferences stored in the Switch WebView;
message content stays in `.codex`. Scratch folders are excluded from project labels and recent folder choices.

## Architecture

The Rust `codex_gui` module runs the downloaded `codex app-server` using asynchronous stdio JSON-RPC.
The WebView can invoke only an explicit operation enum. File validation, config synchronization, downloads,
and archive extraction run in blocking workers. Native window creation and a localhost HTTP endpoint are unnecessary.
The private child process is closed with the application; leaving the GUI page preserves live conversations.

The frontend batches streaming updates, correlates events by thread/turn/item, reconciles completed items with
streamed text, and keeps command/permission approval requests pending until the user responds. Unknown server
requests are rejected explicitly. This is a local workspace; cloud tasks, the official app's extensions and
remote-control features are outside this page's scope.

The protocol was checked against `D:/github/codex/codex-rs/app-server-protocol` and the downloaded official
release. Tests use a local Responses fixture rather than a paid model.

## Verification

```powershell
npm test -w @codex-switch/desktop
npm run build:desktop
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test codex_switch_lib_tests
```

The opt-in installer smoke test downloads and verifies a real release into a temporary directory:

```powershell
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test codex_switch_lib_tests `
  official_release_download_and_extract -- --ignored --nocapture
node scripts/codex-gui-smoke.mjs <downloaded-package>/bin/codex.exe
```

The protocol smoke test covers initialization, models, live deltas while listing conversations, persisted
history, rename, process restart/resume, archive/restore, interruption, and independent on-disk storage.
