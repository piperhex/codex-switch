# CUA Computer Use for Codex GUI

Codex Switch's community marketplace includes **Computer Use 电脑助手**. It installs CUA Driver
0.25.0 for the selected Codex Home and lets Codex GUI use its native desktop tools through STDIO MCP.
Windows x64 and ARM64 are supported by the installer; x64 receives live verification. Other platforms
show an unsupported state. CUA itself supports additional platforms, but their packaging and OS
permission flows are not implemented here.

## Use

1. Open Codex GUI in the Windows desktop application. On its first connection, **Computer Use 电脑助手**
   is automatically installed in the GUI's private Codex Home before the conversation service starts.
   The first installation downloads approximately 28 MB from GitHub; the GUI shows a preparation notice.
2. Other Codex Homes can still install the assistant from the community plugin page.
3. Open a new Codex GUI conversation using the same Home. For example: “打开计算器，计算 6 × 7，并确认结果。”
4. The model can discover CUA tools, inspect applications, operate their controls and receive screenshots.
   The existing GUI tool-result viewer renders the MCP image content directly.
5. Use **停用** to stop that Home's sessions, **启用 / 修复** to restore its setup, or **卸载** to remove
   its managed MCP configuration and skill. Start a new conversation after enabling or repairing.

An enabled card means the files and configuration are present, not that a particular conversation has
completed an MCP handshake. Driver startup failures remain visible as tool/connection errors in Codex.
Windows secure desktop, UAC prompts and elevated applications remain subject to Windows and CUA's limits.

## Lifecycle

- Automatic setup runs on a blocking worker and shares the manual installer's serialization guard.
  A per-home marker survives uninstall; existing installations and manual choices are preserved.
  Setup is attempted once. If it fails, ordinary chat remains available and the GUI directs the user
  to the community plugin page to install or repair it. Unsupported platforms skip setup, and browser
  connections never trigger it.
- `computer_use` owns installation, records, downloads and process lifecycle in separate Rust modules.
  Both Tauri commands delegate blocking work to worker threads. Status polling only checks local files
  and serialized configuration; it neither starts a driver nor scans applications. The frontend permits
  one status request at a time and ignores stale responses after actions or unmounting.
- The release version and each architecture's official SHA-256 are pinned in code. Downloads are bounded,
  verified before extraction, and extracted through an exact filename allowlist into a staging directory.
  The installer uses the application's proxy configuration. It does not execute the upstream installer.
- Binaries live under `%LOCALAPPDATA%/dev.codex.switch/computer-use/0.25.0-windows-<architecture>`.
  They are shared only as cached files. Uninstalling one Home retains this cache for other Homes and
  future reinstalls; it does not modify a separately installed CUA Driver or the user's PATH/autostart.
- Each Home gets a `codex_switch_computer_use` MCP entry pointing to the current Codex Switch executable
  with `--computer-use-mcp=<home-hash>`, plus the managed `codex-switch-computer-use` skill.
  Existing unrelated settings and user-authored same-name skills are preserved; conflicts fail explicitly.
- The helper launches `cua-driver mcp --direct`, so each connection owns its native runtime instead of
  borrowing a global daemon. It uses the default `standard` permission mode, supplies no browser-profile
  grants, and disables CUA telemetry using `CUA_DRIVER_RS_TELEMETRY_ENABLED=0`.
- Records carry an enable flag and a generation. The helper checks them every 250 ms; disable, reinstall
  or removal revokes the previous generation and ends its process. Rapid re-enable cannot revive an old
  connection. This stops subsequent control; it cannot undo actions already performed. Normal stdin EOF
  and installer shutdown also end the session.
- The managed desktop commands are not exposed through the hosted web API. A remote browser cannot use
  this marketplace card to install desktop control on its server.

## Portable source bundle

`apps/desktop/src-tauri/resources/codex-switch-computer-use` also contains a validated Codex plugin
manifest, MCP companion file and skill. Its standalone MCP config expects an independently installed
`cua-driver` on PATH. The desktop marketplace uses its own managed launcher and per-home lifecycle above;
it does not automatically register this source bundle in OpenAI's official plugin marketplace.

## Verification

```powershell
npm run build:desktop
npx vitest run src/pages/skillsMarket/ComputerUseCard/useComputerUse.test.tsx src/pages/codexGui/ConversationDetails.test.tsx --root apps/desktop
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test codex_switch_lib_tests
cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml --bin csw
$env:CSW_CUA_DRIVER_DIRECTORY = '<verified extracted CUA 0.25.0 directory>'
$env:CSW_CUA_CODEX_BINARY = '<GUI-managed codex.exe path>'
node --test scripts/computer-use-protocol.test.mjs
```

The opt-in protocol check uses temporary Homes and the actual CUA executable. It checks initialization,
tool discovery, application listing, screenshot image blocks, per-home revocation and a disabled startup.
When the Codex binary is supplied, it also verifies tool discovery through an ephemeral app-server
conversation. It does not require a model request or change the user's Codex Home. Unit tests cover configuration
preservation, conflicts, failed download recovery, generation revocation and corrupt archive rejection.

## Upstream

- [CUA source and MIT license](https://github.com/trycua/cua)
- [Pinned driver release](https://github.com/trycua/cua/releases/tag/cua-driver-rs-v0.25.0)
- [Driver integration boundaries](https://github.com/trycua/cua/blob/cua-driver-rs-v0.25.0/libs/cua-driver/README.md)
- [Windows MCP tools](https://cua.ai/docs/reference/cua-driver/mcp-tools-windows)

CUA is developed by Cua AI, Inc. Codex Switch supplies this integration; it is not the OpenAI
Computer Use plugin. The driver binaries are downloaded unchanged from the pinned upstream release.
