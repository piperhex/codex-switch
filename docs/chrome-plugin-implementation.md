# Independent Chrome plugin

Codex Switch supplies its own Chrome extension and browser connection program. It does not bundle
OpenAI's proprietary Chrome plugin and does not require ChatGPT or a Node runtime to be installed.
The plugin is available in the desktop application's community marketplace for the selected Codex Home.

## Installation and use

1. Open the plugin marketplace for the intended Codex Home. The built-in Chrome assistant is prepared automatically.
2. Follow the setup dialog to load the exported extension through Chrome's normal extension interface.
3. Confirm that the card reports a connected browser, then send a message using that home.
   Existing GUI conversations reload changed MCP configuration before their next turn.
4. Accept Chrome's website permissions when installing the extension. All HTTP(S) websites are allowed
   by default. Turn off "Allow all websites" in the popup to use per-site session or remembered grants.
5. Use the extension popup to pause control, revoke a site's permission, rename the browser profile,
   or reconnect. The card shows connection settings and disable/enable controls together on one row.
   Explicitly disabled installations remain disabled when the card is reopened or the app is upgraded.

Controlled webpages display a green cursor favicon. Pausing control, revoking access or navigating
restores the website's icon. Focusing a minimized Chrome window also restores the window.
Unless the user explicitly requests an already-open page, the browser instructions require opening
a new background tab in the dedicated Codex group and continuing in task-created tabs. New tabs
automatically join a group belonging to the requesting home in their window; existing user tabs and
same-named user groups are left in place. Opening returns the tab, window and group IDs. A grouping
failure closes only the newly created tab and reports an error. Bringing a page forward requires
an explicit user request in the browser instructions. This is an agent instruction, not an access
restriction on existing tabs; users can still request operations on their own open pages.
The debugger session prepares background input with Chrome's focus emulation without activating a
tab or bringing a window forward. A selected tab created in a minimized window can have a zero-sized
viewport; only that session receives temporary viewport dimensions. The window remains minimized.
Input-driven rendering is allowed to settle before detaching, with a one-second limit so background
animation callbacks do not leave the tool waiting indefinitely. All overrides end with the session.
This fixes the case where input commands acknowledged a click but the background page received no
mouse event. A fresh snapshot is still required to verify the site's actual response.
GUI conversations support the upstream MCP tool confirmation form with single-use allow/deny choices;
site access and tool approval remain separate controls. Chrome webpage tasks prefer the Chrome skill,
which explicitly checks tool availability instead of assuming that an installed skill provides tools.

The setup button copies `chrome://extensions/` and opens Chrome. Paste into the address bar and
press Enter to reach extension management. Chrome rejects that internal address in external startup
arguments, even when the browser process launches successfully. Copy or launch failures remain visible
inside the setup dialog, and the address is also displayed for manual entry.
The setup dialog is 680 pixels wide and adapts to narrow windows. Click the extension directory path
to copy it before selecting the unpacked extension folder in Chrome.

Chrome 125 or newer is required. The desktop supplies an unpacked extension, so its first-time setup
includes a manual Chrome loading step. Exporting the files alone does
not mean the browser extension has been installed. No browser installation policies are changed.

## Desktop upgrades and unpacked extension updates

On application startup, a blocking worker refreshes the exported extension, native-host registration,
managed MCP configuration and enabled homes' skill instructions. The export directory stays the same.
Existing credentials and disabled states are preserved; deleted homes and foreign configuration are
not replaced. This also works without opening the plugin marketplace.

The exporter replaces each changed asset atomically, then publishes `bundle-ready.json` after the
whole bundle is available. A fingerprint baked into `bundle-version.js` identifies the loaded code,
including asset changes that do not change the displayed version. Unpacked extensions check at
startup and once per minute, wait until active browser operations finish, release controlled tabs,
and call `chrome.runtime.reload()` when the completed bundle differs. Chrome storage preferences
are retained. Store installations continue to use Chrome Web Store updates and skip this mechanism.

The automatic reload mechanism starts with extension 1.2.1. Existing 1.2.0 and earlier installations
need one manual reload in Chrome after the first desktop upgrade that supplies this mechanism;
reinstalling or selecting the extension directory again is unnecessary. Later upgrades reload automatically.

## Supported operations

The MCP server exposes 22 tools for connected profiles, existing tabs, opening/navigating/focusing/
closing tabs, history, reload, accessible page snapshots, frames, click/double-click, fill, typing,
keyboard shortcuts, scrolling, selection, checkboxes, drag/drop, screenshots, console logs and waiting for text.
Snapshots provide element references that expire when the document changes. Same-origin, cross-site
and nested frames are supported, including out-of-process Chrome child sessions.

`browser_console_logs` (extension 1.3.0) reads retained console messages and uncaught JavaScript errors,
including unhandled promise rejections. It returns the main document's logs by default; use `frameId`
from `browser_frames` for a specific iframe. `level` selects `all`, `debug`, `log`, `info`, `warn` or
`error`; `limit` returns up to 1–200 recent matching entries (default 100). Results include millisecond
Unix timestamps, one-based source lines/columns and bounded stacks. Object arguments use Chrome's
descriptions, without expanding properties. Output is bounded by both count and serialized size;
`truncated` reports omitted entries or shortened fields.

This is an on-demand read of Chrome's retained messages, not a persistent recording. Reading does
not clear messages. Navigation, `console.clear()` and Chrome's own retention limits can remove
older messages. Network/worker logs and extension isolated worlds are not included. Each read
checks access to the selected document, isolates its frame/session and rejects document changes.
It uses the existing short-lived debugger connection and adds no permissions or persistent storage.

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

Chrome's required host permissions cover HTTP(S) websites, so ordinary installations request permission
once and do not display an extra prompt for each website. The all-site mode applies to authenticated
Codex Switch clients in that Chrome profile. Users can select per-site confirmation instead; those
additional grants are scoped to the requesting home. Neither mode bypasses Chrome's own host permissions.
Denial, closing or expiry of a per-site permission request does not authorize access. Pause/revoke
cancels pending work and detaches browser control. Removing host permissions in Chrome also stops
pending work and detaches control. Expired
permission windows are closed automatically. Browser profile names and site origins are visible in
the extension, while credentials are never passed to websites or returned as tool output.

The managed browser skill instructs agents to use fresh references, verify action outcomes, treat
webpage content as untrusted, preserve user tabs and respect permission decisions. Password values
are masked in accessible snapshots; screenshots can still contain visible page content.

## Verification

### 2026-09-20 console log reading

Real Chrome for Testing checks in an isolated Windows profile verified logs emitted before the
first tool call, all console levels, assertions, uncaught errors and promise rejections. Repeated
reads preserve messages; filtering and limits return the expected entries. Same-process and
cross-site iframes return only their own logs. Button-generated logs remain readable after the
action's debugger connection closes; clearing logs and navigating do not return old messages.
Reading leaves the minimized window and selected tab unchanged.

Extension regression tests also cover invalid options, frame/tab/session isolation, ignoring
extension worlds, output bounds, navigation/context replacement, permission checks, cancellation
and listener cleanup. The compiled MCP protocol test checks tool discovery and `console_logs` relay.

### 2026-09-16 default grouped pages

The skill, MCP initialization instructions and tool descriptions now require new grouped background
tabs unless the user explicitly requests an already-open page. Extension tests cover default grouping,
concurrent opens, separate homes/windows, worker restart, closed/moved groups, foreground requests,
failure cleanup, cancellation, denied website access and preserving an existing page's group.
These checks use mocked Chrome APIs; this change has not been verified in a live Chrome session.

### 2026-09-14 extension setup launch regression

Reproduced the old setup button in the Windows 11 Hyper-V guest: the action returned success,
but Chrome showed a new tab instead of extension management. Chromium's
[external startup URL validation](https://chromium.googlesource.com/chromium/src/+/lkgr/chrome/browser/ui/startup/url_util.cc)
does not accept `chrome://extensions/` as a startup URL.

Tested the fixed Tauri release through the actual setup button. The clipboard contained exactly
`chrome://extensions/`; Chrome opened an `about:blank` window. Pasting in its address bar and pressing
Enter displayed the real extension manager, confirmed by its window title and a desktop screenshot.
The marketplace remained responsive while the action and status refresh ran (64 timer callbacks at
20 ms); the setup text measured 400 CSS pixels wide. This flow deliberately requires paste and Enter;
it does not claim that launching the browser navigates directly to the extension manager.

Checks passed: Rust formatting, strict Clippy, 1131 Rust tests (5 ignored), 11 relevant React tests,
the desktop TypeScript/Vite production build, and the repository's Windows Tauri application build.
The existing Vite chunk-size warning remains. macOS/Linux launch changes were not tested live.

### 2026-09-14 plugin recovery regression

Tested the packaged Windows executable in the local Windows 11 Hyper-V guest with the existing
upstream connection and a separate Chrome test profile. The existing Computer Use installation
changed from `needsRepair=true` to enabled without another driver download. Five repeated entries
into the marketplace while an upstream turn was active showed ready cards within the first
20 ms polling sample (observed 21–22 ms), without repair warnings.

In the same GUI thread, disable Chrome, complete a turn, enable Chrome, and send another message:
actual `codex_switch_chrome` calls became available without recreating the thread. The local fixture
received `CHROME-RELOAD-PASS` through `browser_fill`; `browser_click` and a fresh snapshot confirmed
`PASS: CHROME-RELOAD-PASS`. The final build restored a deliberately minimized window through
`browser_focus`. A screenshot showed the green cursor favicon; clicking Pause restored the
fixture's original purple favicon. The newer upstream MCP confirmation form was displayed and
accepted through the GUI rather than automatically rejected as unsupported.

The copied-home configuration conflict is covered by Rust tests; it was not reproduced in this guest.
Final checks passed: 1131 Rust tests (5 ignored), strict Clippy, Rust formatting, 35 relevant React
tests, 19 Chrome extension/protocol tests, and the desktop TypeScript/Vite and Windows release builds.
The existing Vite chunk-size warning remains.

### Initial implementation

Automated validation passed:

- Rust formatting and Clippy with warnings denied; 898 Rust tests passed, with 4 pre-existing ignored tests.
- 12 marketplace React tests covering lifecycle, single-flight polling and obsolete responses.
- 13 extension tests covering consent, cancellation/window cleanup, grant isolation, stale references,
  password masking, child-frame session routing, default all-site access, and returning to per-site mode.
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

The final extension refresh and native reconnection were verified with the installed release.
The user paused control in the real Chrome popup; the MCP tab operation was immediately rejected.
After the user resumed control and revoked the local test-site grants, the grant list was empty.
A new request for the revoked test site displayed a permission prompt and was rejected when the
user denied it. No test page opened, no grant was restored and no permission window remained.
These live checks complement the automated cancellation and permission-window cleanup tests.

Version 1.1.0 was refreshed in real Chrome and reported all-site access with an empty per-site grant list.
Opening the local fixture and reading/filling/clicking its cross-origin child frame succeeded immediately,
without a per-site permission prompt. The resulting form contained the entered Chinese test text.
After the operations, all-site access remained enabled, the per-site grant list stayed empty and no
permission requests were pending. The task-created page was closed after verification.

The toolbar popup uses a fixed 360 x 460 CSS-pixel document with an internally scrolling site list.
Its root dimensions do not depend on the viewport, avoiding a feedback loop with Chrome's automatic
popup sizing. The name field and save button share one row. Browser previews of empty/long lists,
connection errors and narrow/wide viewports retained the same outer dimensions without horizontal overflow.

The tested Windows release replaced the user's installed application and restarted successfully.
Its SHA-256 is `FD7E3A3A6F9D80E0A0DEE1382696A342884C43FA02A73D564844D1E941B9D34F`.
This earlier release required a manual browser refresh. The automatic upgrade behavior described above
replaces that refresh step once extension 1.2.1 or newer has been loaded.

## Repeatable checks

```powershell
npm run build:desktop
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test codex_switch_lib_tests
node --test scripts/chrome-plugin.test.mjs scripts/chrome-plugin-snapshot.test.mjs scripts/chrome-plugin-frames.test.mjs
node scripts/chrome-plugin-tab-groups.test.mjs
node scripts/chrome-plugin-tab-indicator.test.mjs
node --test scripts/chrome-plugin-update.test.mjs
node --test scripts/chrome-plugin-driver.test.mjs
node --test scripts/chrome-plugin-console.test.mjs
node scripts/chrome-plugin-console.e2e.mjs
cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml --bin csw
node --test scripts/chrome-plugin-protocol.test.mjs
```

Use the explicit Rust test target on Windows; a filtered invocation without it can select the disabled
library harness and fail before running tests. For a release STDIO check, set `CSW_CHROME_TEST_BINARY`
to the release executable and run `node scripts/chrome-plugin-protocol.test.mjs --initialize-only`.
Release builds intentionally ignore the debug-only `CSW_CHROME_TEST_ROOT` override. The full debug
protocol fixture uses temporary credentials and a simulated extension without changing Chrome registration.

`node scripts/chrome-plugin-background.e2e.mjs` tests real extension input in an isolated Chrome profile.
Install a Playwright Chromium build or set `CSW_CHROME_TEST_BROWSER` to a Chrome for Testing executable.
On Windows the fixture creates its own unfocused window and minimizes it, testing both selected and
unselected tabs, trusted clicks, animation updates, input, checkboxes, and same/cross-origin frames.
It asserts that window state and tab selection are unchanged. The harness attaches raw CDP only to
the extension worker: Playwright page setup would otherwise supply its own focus emulation and hide
the original bug. The test does not connect to the user's native host or touch existing browser profiles.
