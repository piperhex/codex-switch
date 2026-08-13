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


## Clean Code Constraints

1. A single source file should generally not exceed **500 lines**. If it does, split it by responsibility.
2. A single function should generally not exceed **50 lines**.
3. A single React component should generally not exceed **200 lines**.
4. A single custom Hook should generally not exceed **150 lines**.
5. A function should have no more than **4 parameters**. Use an options object when more parameters are needed.
6. Control-flow nesting should not exceed **3 levels**. Prefer early returns to reduce nesting.
7. The cyclomatic complexity of a single function should not exceed **10**.
8. A single line of code should not exceed **120 characters**.
9. Each module should have one clear responsibility. Avoid God Objects and God Functions.
10. Avoid using `any`. If its use is truly necessary, the reason must be documented. Prefer `unknown` where appropriate.
11. Avoid magic numbers and magic strings. Extract them into meaningful constants.
12. Avoid duplicated code, but do not introduce unnecessary abstractions solely for the sake of DRY.
13. In React, separate business logic from presentation logic. Extract complex logic into custom Hooks or standalone functions.
14. Each `useEffect` should handle one clearly defined side effect or synchronization responsibility.
15. Avoid deeply nested ternary expressions and overly complex conditional logic in JSX.
16. Variable, function, and type names must clearly express their business meaning. Avoid meaningless abbreviations.
17. Comments should explain design decisions, constraints, and exceptional cases rather than restating what the code already does.
18. Do not keep commented-out code, dead code, unused variables, or unused dependencies.
19. Modules should communicate through public interfaces. Do not depend on another module's internal implementation details.
20. When modifying existing code, prioritize local consistency and avoid unrelated large-scale refactoring for small changes.
21. Rust source files should generally not exceed **500 lines**. Split large files by domain or responsibility.
22. A single Rust function should generally not exceed **50 lines**. Complex logic should be extracted into smaller functions or dedicated modules.
23. Tauri `command` functions should remain thin. They should primarily handle input validation, permission checks, state access, and delegation to service-layer logic.
24. Do not place complex business logic directly inside `#[tauri::command]` functions.
25. `main.rs` and `lib.rs` should only contain application bootstrap, plugin registration, command registration, and high-level module wiring. Avoid business logic in these files.
26. Organize Rust code by responsibility, for example:

```text
src-tauri/src/
├── commands/
├── services/
├── models/
├── state/
├── errors/
├── utils/
├── platform/
├── lib.rs
└── main.rs
```

27. Avoid large catch-all files such as `commands.rs`, `utils.rs`, or `models.rs`. Split them into domain-specific modules when they grow significantly.
28. Avoid `unwrap()` and `expect()` in production code unless failure represents a truly unrecoverable invariant. Prefer proper error propagation with `Result`.
29. Do not silently discard errors using patterns such as:

```rust
let _ = some_fallible_operation();
```

unless ignoring the error is intentional and documented.

30. Define meaningful application error types instead of returning arbitrary strings from internal Rust APIs.
31. Use `thiserror`-style typed errors for internal application logic where appropriate. Convert errors into frontend-safe representations only at the Tauri boundary.
32. Do not expose sensitive internal error details, filesystem paths, credentials, tokens, or stack information directly to the frontend.
33. Shared mutable state must have a clearly defined ownership model. Avoid unnecessary global mutable state.
34. When using `Mutex`, `RwLock`, or other synchronization primitives, keep lock scopes as short as possible.
35. Never hold a synchronous lock across an `.await` point.
36. Avoid blocking operations inside async Tauri commands. CPU-intensive or blocking I/O operations should be delegated to appropriate blocking tasks or worker threads.
37. Avoid unnecessary `clone()` calls. Prefer borrowing when ownership does not need to be transferred.
38. Avoid excessive use of `Arc<Mutex<T>>`. Use it only when shared ownership and mutation are actually required.
39. Prefer enums and strongly typed structures over string-based state or mode identifiers.

For example, prefer:

```rust
enum AccountStatus {
    Active,
    Disabled,
    Expired,
}
```

over:

```rust
let status = "active";
```

40. All data crossing the Tauri IPC boundary should use explicit serializable request and response types.
41. Do not expose large internal Rust structs directly through Tauri commands merely because they implement `Serialize`. Define dedicated DTOs when appropriate.
42. Validate all data received from the frontend. Never assume IPC input is trusted.
43. File paths received from the frontend must be validated before filesystem operations are performed.
44. Shell commands, process execution, filesystem access, and network operations must follow the principle of least privilege.
45. Never construct shell commands by directly concatenating untrusted frontend input.
46. Avoid exposing generic commands such as:

```rust
execute_command(command: String)
read_file(path: String)
write_file(path: String, content: String)
```

unless strict validation and permission restrictions are implemented.

47. Tauri capabilities and permissions should follow the principle of least privilege. Only enable APIs and scopes actually required by the application.
48. Platform-specific behavior should be isolated behind dedicated modules instead of scattering `#[cfg(...)]` blocks throughout business logic.

Prefer:

```text
platform/
├── windows.rs
├── macos.rs
└── linux.rs
```

rather than many unrelated platform checks across the codebase.

49. Unsafe Rust is prohibited unless absolutely necessary. Every `unsafe` block must include a comment explaining the safety invariant.
50. Run `cargo fmt` and ensure the code passes `cargo clippy` without unjustified warnings.
51. Do not suppress Clippy warnings globally merely to make CI pass. Suppress individual warnings only when there is a documented reason.
52. Public functions, complex domain types, and non-obvious invariants should have appropriate Rust documentation comments.
53. Unit tests should cover important pure business logic independently from the Tauri command layer.
54. Tauri commands should be testable indirectly by keeping business logic outside the IPC layer.