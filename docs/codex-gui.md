# Codex GUI

Codex GUI is the chat workspace embedded in Codex Switch, available in the desktop app and its hosted web UI.
Its navigation entry appears immediately after
Providers (三方模型及中转). It supports project folders, text and image input, model and reasoning selection,
streamed Markdown replies, command output, file diffs, plans, permission approvals, questions, interruption,
history, search, renaming, pinning, and archiving/restoring conversations.

The GUI account picker includes official accounts, custom Providers, and upstream Codex Switch Providers.
Codex GUI remembers its own account independently of the account manager and other applications. The first
visit starts with the current supported account; later switches and restarts preserve the GUI's choice.
With the local proxy running, a GUI switch applies to subsequent requests without interrupting an existing
reply. Shared automatic fallback and concurrent account routing do not change the GUI's selected account.
The GUI's remaining quota and Provider model choices follow its own selection. All connected GUI browsers
share this selection, and upstream Codex Switch Providers continue to use the live Codex model catalog.

Opening or reopening a conversation displays its latest ten messages. Scroll upward to load ten earlier
messages at a time; a loading indicator appears and the current reading position is preserved.
Incoming replies continue updating while browsing history.
Processing details and their screenshots load when expanded. Long tool outputs appear in short pages;
**复制完整内容** copies the complete output regardless of the page being viewed.

Type `/` in the message box to choose a command or skill. **压缩** (also searchable as `/compact`)
compacts the current conversation's context and shows its latest context usage when available.
Select it with the mouse or Enter/Tab; it runs directly without sending the command as a message.
Wait for the current task and queued messages to finish before compacting. Progress appears in the conversation.

Choose **删除** from a conversation's menu to move it to the session manager's recycle bin.
In **会话管理**, select **内置 Codex GUI** as the source home and open **回收站**. Select conversations
and a destination under **恢复到 Codex Home**, then restore. Existing conversations in the destination
are skipped. Initialize the destination with a compatible Codex version first; if its conversation
storage cannot preserve the complete history, the backup stays in the recycle bin for retrying.
Conversations with active replies or queued messages cannot be deleted until those are handled.

Use **+** to add files, folders, or an installed and enabled plugin. File and folder selections add references
to their full paths; the selected access mode still controls what Codex can read or edit. The hosted web UI
accepts paths on the Switch host. Plugin selections stay attached to the draft and are included when sending,
including queued messages and steering. Plan mode is not included in this menu.

In the desktop app, click or right-click a file link or an edited-file name to open its file menu.
**打开方式** lists recognized local editors and terminals; Windows also offers **其他应用…** to open
the system application chooser. The menu supports opening with the default app, saving a copy, copying
the absolute path or text contents, and revealing the file in the file manager. Edited-file menus retain
**查看差异**, and **审核** still opens the complete diff. VS Code and JetBrains editors retain supported
line references. Relative paths resolve against the conversation's actual workspace, including projectless tasks.
Text copying accepts UTF-8 files up to 2 MB. Application discovery and file I/O run on background workers.
These native actions are desktop-only; browsers retain path copying and diff viewing.

Choose **+ → 目标** to describe a result and start working toward it. Goals are saved with the conversation;
Codex continues until the goal is completed, paused, blocked, or reaches a usage limit. Click the goal above
the input to edit, pause, continue or remove it. **停止生成** pauses an active goal before stopping its current
reply. Goal progress comes from Codex itself and survives reopening the conversation.

Paste images directly into the message box with Ctrl+V (Cmd+V on macOS), or choose **+ → 文件和文件夹 → 添加图片**.
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

On Windows this normally resolves to `%APPDATA%/dev.codex.switch`. Initial Codex preferences are imported once;
GUI account selection is stored separately in `codex-gui-account.json`. GUI requests use a dedicated local
proxy route, and reconnecting does not import another application's authentication. The GUI home is excluded
from shared account and Provider synchronization. Official conversation files, indexes, and databases are
never imported or edited. SQLite and log locations are overridden on the private process command line, even
if the imported configuration specifies other locations. Reconnect after editing Codex configuration.
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

The desktop message view lazily mounts items, including processing activities and generated images.
Its ten-item window expands from a stable item cursor so live replies do not evict loaded history.
The controller retains complete turns for editing, continuation, and file review actions.
Collapsed process groups, individual activities, and structured payloads do not mount their contents.
Tool text is limited to 8,000 characters per page to bound Markdown parsing and DOM work for oversized records.

Browser event replay uses an independent cursor per browser, with a bounded in-memory log. Polls are single-flight,
shared between conversation and download subscribers, and never scan storage. Stale cursors and server restarts
trigger a state refresh instead of silently dropping stream fragments. Desktop events retain their native delivery.

The protocol was checked against `D:/github/codex/codex-rs/app-server-protocol` and the downloaded official
release. Tests use a local Responses fixture rather than a paid model.

## Verification

New conversations can search and switch local Git branches, create a branch, or create a local worktree
from the selected checkout's current commit. Worktrees live in the app data directory under `git-worktrees`;
the new conversation uses the new directory, while uncommitted files stay in the original checkout.
Checkout never uses force, and branches checked out in another worktree are marked unavailable.

Edited-file cards support undo after a reply finishes. The backend reads the selected turn's completed
file-change records, prepares inverse edits in a temporary directory, and checks every affected file before
applying them. Conflicts leave the workspace untouched; unrelated edits and the Git index are preserved.
Undo receipts survive reopening the conversation. Text updates require Git, including for folders without
a Git repository; unsupported changes and paths outside the conversation directory are rejected.
Git and undo commands run on blocking workers, with authenticated browser dispatch sharing the same implementation.

```powershell
npm test -w @codex-switch/desktop
npm run build:desktop
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test codex_switch_lib_tests
npm exec -w @codex-switch/desktop -- playwright test --config playwright.chat.config.ts file-menu.pw.ts
```

The opt-in installer smoke test downloads and verifies a real release into a temporary directory:

```powershell
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test codex_switch_lib_tests `
  official_release_download_and_extract -- --ignored --nocapture
node scripts/codex-gui-smoke.mjs <downloaded-package>/bin/codex.exe
```

The protocol smoke test covers initialization, models, image-only input reaching the model request,
live deltas while listing conversations, persisted
history, rename, process restart/resume, archive/restore, compaction and context usage updates,
interruption, and independent on-disk storage.
