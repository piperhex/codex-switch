# Development and Debugging

## Environment Setup

Install Node.js, npm, the latest stable Rust toolchain, and the Tauri 2 dependencies for your platform. Then install project dependencies:

```powershell
npm install
```

Dependency versions are locked by `package-lock.json` and `src-tauri/Cargo.lock`. Include both lockfile changes whenever a dependency update is intentional.

## Common Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the browser preview with data from `src/demo.ts` |
| `npm run dev:app` | Start the complete Tauri desktop application |
| `npm run build` | Type-check and build the frontend |
| `npm run build:app` | Build desktop installers |
| `npm run check:rust` | Check Rust formatting and run Rust tests |
| `npm run check` | Run all pre-submission frontend and backend checks |

## Browser Preview and Desktop Mode

The browser preview does not read real files, start OAuth, or access real accounts. `src/api/backend.ts` selects the appropriate implementation by detecting the Tauri runtime. When adding a backend operation, also define its preview behavior: provide a demo result or clearly report that the operation is unavailable.

Use a custom Codex directory in desktop mode to avoid changing your everyday environment:

```powershell
$env:CODEX_HOME = "$PWD\.local-codex"
npm run dev:app
```

The `.local-codex/` directory may contain credentials. Confirm that it cannot be committed before using it. A temporary directory outside the workspace is safer.

## Debugging Guidelines

- UI or state issue: reproduce it first with `npm run dev` and demo data.
- IPC issue: verify that command names and arguments in `src/api/backend.ts` match `commands.rs`.
- File issue: set a temporary `CODEX_HOME` instead of modifying an account you regularly use.
- OAuth issue: confirm that local ports `1455` and `1457` are free, then try the system-browser flow.
- Rust logic: prefer unit tests around the pure parsing functions in `auth.rs` and `codex_api.rs`.

## Adding a Feature

1. Define the smallest redacted transfer model in `models.rs`.
2. Put external API, storage, or identity logic in the corresponding Rust module.
3. Orchestrate the use case in `commands.rs` and register the command in `lib.rs`.
4. Add a typed wrapper to `src/api/backend.ts`.
5. Manage business state in a hook, then render it through pages and components.
6. Update the relevant architecture or usage documentation and run `npm run check`.

Pages must not call `invoke` directly. Tauri command functions must not absorb JWT parsing, HTTP response parsing, or low-level file-replacement logic.
