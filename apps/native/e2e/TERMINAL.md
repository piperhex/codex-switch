# Terminal keyboard regression

Run on an Android API 35 emulator with a software keyboard. The fixture uses
`com.codexswitch.mobile.terminaltest`, a local shell simulation, and a separate
`terminal-fixture.apk`; it does not connect to a computer or replace the normal app.

From the repository root in PowerShell (Android SDK and Java must be configured):

```powershell
$env:NODE_ENV = 'production'
$env:NODE_PATH = (Resolve-Path apps/native/node_modules).Path
$env:ANDROID_SERIAL = 'emulator-5580'
Push-Location apps/native/android
.\gradlew.bat assembleRelease -I ../e2e/terminal.init.gradle -PreactNativeArchitectures=x86_64
Pop-Location
node apps/native/e2e/terminal-keyboard.mjs
```

The script verifies that the header controls, session tab, WebView and shortcuts
stay on screen in portrait, with wrapping disabled, in landscape, and after
hiding/reopening the terminal. It checks the layout before, during and after
keyboard use, that height is restored when the keyboard closes, and that hiding
keeps the session alive. Screenshots go to
`.codex-tmp/terminal-keyboard-regression/`. Inspect the current command and cursor
in those screenshots. `--installed` tests the fixture already on the emulator.

The original `navigationBarTranslucent` modal fails the first keyboard check:
its WebView and shortcuts extend below the keyboard's top edge.

The old landscape drawer combined a full percentage height with a flex layout
aligned to the bottom. The keyboard check must also assert header visibility:
shortcuts can remain above the keyboard while the header is pushed off screen.
Landscape puts session tabs, controls and shortcuts in one toolbar to leave room
for command rows above tall keyboards. The regression also requires
enough output height for two complete rows, including padding and the scrollbar.

The bundled terminal's command visibility, row fitting, wrapping and touch
scrolling are also covered by `apps/web/e2e/chat-terminal-display.pw.ts`:

```powershell
npm run test:chat:e2e -w @codex-switch/web -- chat-terminal-display.pw.ts --project=mobile
```

iOS keyboard avoidance uses `KeyboardAvoidingView` and still needs device testing
on a Mac; the Android regression does not validate iOS layout.
