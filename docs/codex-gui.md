# Codex GUI

Codex GUI is the chat workspace embedded in Codex Switch, available in the desktop app and its hosted web UI.
Its navigation entry appears immediately after
Providers (三方模型及中转). It supports project folders, text and image input, model and reasoning selection,
streamed Markdown replies, command output, file diffs, plans, permission approvals, questions, interruption,
history, search, renaming, pinning, and archiving/restoring conversations.

Paste images directly into the message box with Ctrl+V (Cmd+V on macOS), or use the image button to select files.
Attachments appear as thumbnails above the text, each with a remove button. A message can contain up to eight
PNG, JPEG, WebP, or GIF images, at most 20 MB each, and can be sent without text. Failed sends retain the draft
and its images for retrying; switching conversations keeps each draft separate.

Selecting a project is optional. Hovering a selected folder reveals a removal button on its left; removing
the selection leaves the actual folder intact and applies to the next message. Project changes are disabled
while a turn is running. Projectless conversations appear under the “无项目” group.

## Browser conversations

Open the web address provided by the running Codex Switch host, then choose **Codex GUI**. The same page is
available when Switch runs with `csw --headless --port=18080`. A standalone frontend preview has no conversation
backend; the separate cloud account-sync client under `/web/` is not this hosted interface.

Codex is installed and runs on the Switch host. Conversations, accounts, model configuration, tools and project
files all belong to that host; nothing needs to be installed on the device running the browser. If Codex has not
been installed on the host, use **下载并开始** on the page. For a project, enter the full folder path on the host,
or leave the project empty. Browser messages must fit the web interface's 8 MB request limit, including encoded
images; reduce image sizes if a message exceeds it. Failed sends preserve the draft.

For another trusted device, enable LAN listening and enter the web access key. An authenticated browser can start,
continue, interrupt and manage GUI conversations, answer permission requests and install Codex on the host.
The selected Codex access mode and approval flow still apply. Host administration remains restricted, including
changing the proxy's fast mode from a remote browser. All connected browsers share the host's GUI workspace.

Replies, permission requests and download progress arrive through the authenticated web interface. Interrupted
connections retry and refresh conversation state. Leaving the page stops browser polling; tasks keep running on
the host and reconnecting loads their current state.

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
Desktop and web clients invoke the same explicit operation enum. Web requests execute asynchronous commands from
the existing HTTP request worker. File validation, config synchronization, downloads,
and archive extraction run in blocking workers. The browser uses Switch's existing hosted HTTP endpoint.
The private child process is closed with the application; leaving the GUI page preserves live conversations.

The frontend batches streaming updates, correlates events by thread/turn/item, reconciles completed items with
streamed text, and keeps command/permission approval requests pending until the user responds. Unknown server
requests are rejected explicitly. This is a local workspace; cloud tasks, the official app's extensions and
remote-control features are outside this page's scope.

Browser event replay uses an independent cursor per browser, with a bounded in-memory log. Polls are single-flight,
shared between conversation and download subscribers, and never scan storage. Stale cursors and server restarts
trigger a state refresh instead of silently dropping stream fragments. Desktop events retain their native delivery.

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

The protocol smoke test covers initialization, models, image-only input reaching the model request,
live deltas while listing conversations, persisted
history, rename, process restart/resume, archive/restore, interruption, and independent on-disk storage.
