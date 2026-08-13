# Agent Notes

## Automatic Commit and Push

- After completing the requested changes and verifying them successfully, automatically commit the changes made for the current task and push the current branch to its configured upstream. Do not wait for a separate request to commit or push.
- Never include unrelated existing changes in the commit. If verification fails, the branch has no configured upstream, or the push is blocked, report the issue instead of bypassing checks or rewriting history.

## User-Facing Prompts and Copy

- Write all user-facing prompts and copy in natural, clear, and easy-to-understand language. Do not mention implementation details, internal processes, or other technical details.
- Whenever a user request involves writing prompts or copy, proactively refine and improve the wording so it is concise, friendly, and accurate instead of simply repeating the user's original wording.
- Keep temporary messages, including hover tooltips, popovers, and confirmation prompts shown after a click, visually compact. Limit the text area to a maximum width of `400px`, which is roughly one line of 25 full-width Chinese characters at the standard body-text size. Wrap longer copy onto additional lines instead of widening the message.

## Tauri 2 WebView Window Creation On Windows

- Do not create a `WebviewWindowBuilder` from a synchronous Tauri command on Windows. In this repo, opening the Token Usage window from a sync `#[tauri::command]` produced a native window shell, but the WebView content stayed white, the close button did not work reliably, and DevTools could not be opened.
- Use an `async fn` command for window creation instead. The working fix was changing `show_token_usage_window` from a synchronous command to `pub(crate) async fn show_token_usage_window(...) -> Result<(), String>`.
- If adding a new Tauri window label, also add it to `apps/desktop/src-tauri/capabilities/default.json`. For Token Usage, the label is `token-usage`.
- Prefer hash routing for single-page subwindows loaded from packaged assets, for example `WebviewUrl::App("index.html#token-usage".into())`, and keep the frontend route parser compatible with both query and hash routes.
- For auxiliary windows that previously got stuck, add a Rust-side close fallback in `on_window_event` that destroys the specific window label instead of hiding the main app.

## Tauri UI Responsiveness and Polling

- Do not expose blocking work through a synchronous `#[tauri::command]` when the frontend can call it during rendering, loading, polling, automatic refresh, or event handling. A synchronous command can block the Windows UI message thread and make the application appear frozen.
- Implement commands as `async fn` and move blocking work to `tauri::async_runtime::spawn_blocking` whenever the operation can wait on a `Mutex` or `RwLock`, access SQLite, read or write files, call blocking network APIs, inspect processes, or perform other potentially slow system work. Use native asynchronous I/O when it is already available.
- Never wait for a shared lock on the UI thread. This is especially important when another task can hold the lock across a network request, SQLite busy timeout, database migration, or filesystem scan.
- Keep database serialization guards alive for the complete read or write operation, not only while opening the connection or initializing the schema. UI callers must await the asynchronous command without performing database work themselves.
- Polling callbacks must be single-flight. If the previous refresh is still running, skip the next interval instead of starting an overlapping request. Clear timers and subscriptions when the component unmounts or the feature becomes inactive.
- High-frequency polling, such as the two-second proxy session refresh, must not synchronously scan conversation metadata, Provider files, model catalogs, or token-usage databases. Move the complete operation off the UI thread, including any helper functions it calls.
- If the headless web compatibility layer needs to call an asynchronous Tauri command, adapt it explicitly in its request worker, for example with the existing `block_on` helper. Do not change the desktop command back to a synchronous function for web compatibility.
- For changes to proxy, Provider, concurrent-routing, cloud-sync, or token-usage UI flows, verify responsiveness while requests are active and while the relevant polling view is open. Run Rust formatting and tests plus the desktop TypeScript/Vite production build before handing off the change.
