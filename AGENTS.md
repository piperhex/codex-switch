# Agent Notes

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
