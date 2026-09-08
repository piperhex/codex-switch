# Independent Chrome plugin

Codex Switch supplies its own Chrome extension and browser connection program. It does not bundle
OpenAI's proprietary Chrome plugin and does not require ChatGPT or a Node runtime to be installed.
The plugin is available in the desktop application's community marketplace for the selected Codex Home.

## Installation and use

1. Select the intended Codex Home in the plugin marketplace and install the Chrome browser assistant.
2. Follow the setup dialog to load the exported extension through Chrome's normal extension interface.
3. Confirm that the card reports a connected browser, then start a new Codex session using that home.
4. Approve website requests in Chrome. Grants can last for the browser session or be remembered.
5. Use the extension popup to pause control, revoke a site's permission, rename the browser profile,
   or reconnect. The marketplace provides repair, disable and uninstall actions for each home.

Chrome 125 or newer is required. The extension has not been published to the Chrome Web Store;
the current setup therefore includes a manual Chrome loading step. Exporting the files alone does
not mean the browser extension has been installed. No browser installation policies are changed.

## Supported operations

The MCP server exposes 21 tools for connected profiles, existing tabs, opening/navigating/focusing/
closing tabs, history, reload, accessible page snapshots, frames, click/double-click, fill, typing,
keyboard shortcuts, scrolling, selection, checkboxes, drag/drop, screenshots and waiting for text.
Snapshots provide element references that expire when the document changes. Same-origin, cross-site
and nested frames are supported, including out-of-process Chrome child sessions.

File upload/download, JavaScript dialogs and arbitrary JavaScript execution are not exposed as tools.
This is an independent implementation of the core browser workflow, not exhaustive feature parity
with another vendor's integration. Windows has been tested with real Chrome. macOS/Linux registration
paths are implemented but have not received equivalent live platform verification.

## Architecture

- The Manifest V3 extension owns browser access, grants and pause state. It uses the documented
  [Chrome debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger).
- [Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
  launches the Codex Switch executable in a dedicated helper mode. The same executable supplies
  STDIO MCP with `--chrome-mcp=<client-id>`. Both modes return before Tauri/WebView startup.
- A framed, authenticated loopback transport connects the two helpers. Requests and messages are
  bounded. Revoking a home credential cancels its pending work; disconnects do not replay actions.
- Each home has a separate random credential and an owned `codex_switch_chrome` MCP entry. Installation
  preserves unrelated configuration, rejects conflicting entries and leaves partial failures repairable.
- Windows registers the native host for the current user. Credential storage inherits the user's
  AppData ACL; Unix credential directories are restricted before token or temporary files are written.
- Tauri commands delegate filesystem, process and connection work to blocking workers. The marketplace
  polls only while active, permits one refresh at a time and ignores obsolete responses after actions.

Website grants are scoped to the requesting home. Denial, closing or expiry of a permission request
does not authorize access. Pause/revoke cancels pending work and detaches browser control. Expired
permission windows are closed automatically. Browser profile names and site origins are visible in
the extension, while credentials are never passed to websites or returned as tool output.

The managed browser skill instructs agents to use fresh references, verify action outcomes, treat
webpage content as untrusted, preserve user tabs and respect permission decisions. Password values
are masked in accessible snapshots; screenshots can still contain visible page content.

## Verification

Automated validation passed:

- Rust formatting and Clippy with warnings denied; 898 Rust tests passed, with 4 pre-existing ignored tests.
- 12 marketplace React tests covering lifecycle, single-flight polling and obsolete responses.
- 10 extension tests covering consent, cancellation/window cleanup, grant isolation, stale references,
  password masking and child-frame session routing.
- Compiled MCP/native-host protocol checks for startup, tool discovery, authentication, relay,
  per-home revocation, cancellation and disconnect handling.
- Desktop TypeScript/Vite production build and Windows release build. Vite reports the existing
  large-chunk warning.

Real Chrome checks on Windows used only the application's public STDIO MCP tools and a temporary local
test page. Verified page outcomes include Chinese input, clear/append, selection, checkbox, form click,
double-click, contenteditable, keyboard modifiers, HTML drag/drop, scroll and a viewed JPEG screenshot.
Tab creation, focus, close, navigation, back/forward, reload, wait and stale-reference rejection passed.
Snapshots omitted the fixture password. Same-origin, cross-site and two-level nested iframe input/click
returned the expected form results. Extension refresh established a new working connection.

Both the GUI-managed Codex CLI and the separately installed Codex CLI loaded all 21 tools through
`mcpServerStatus/list`. These checks did not require a model generation request. The marketplace card
and setup dialog were visually checked, and the user completed the real installation flow.

Live pause/revoke controls require the user to operate the Chrome popup; automated permission and
protocol tests cover their cancellation behavior. The browser's extension installation/refresh UI
must also be operated by the user through its normal workflow.

## Repeatable checks

```powershell
npm run build:desktop
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test codex_switch_lib_tests
node --test scripts/chrome-plugin.test.mjs scripts/chrome-plugin-snapshot.test.mjs scripts/chrome-plugin-frames.test.mjs
cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml --bin csw
node --test scripts/chrome-plugin-protocol.test.mjs
```

Use the explicit Rust test target on Windows; a filtered invocation without it can select the disabled
library harness and fail before running tests. For a release STDIO check, set `CSW_CHROME_TEST_BINARY`
to the release executable and run `node scripts/chrome-plugin-protocol.test.mjs --initialize-only`.
Release builds intentionally ignore the debug-only `CSW_CHROME_TEST_ROOT` override. The full debug
protocol fixture uses temporary credentials and a simulated extension without changing Chrome registration.
