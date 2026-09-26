# Remote desktop

The phone and Web chat toolbox opens the selected computer's remote desktop. The first host implementation
supports the primary Windows display. macOS/Linux hosts return an explicit unsupported-platform message.
The viewer works on Android/iOS through `react-native-webrtc` and on Web through the browser's WebRTC engine.

## Media and threading

- The existing authenticated, end-to-end encrypted chat connection carries offer/answer, ICE and display settings.
  Host ownership is the individual chat session, not a client-supplied owner or the persistent terminal owner.
- A separate WebRTC connection carries video with DTLS/SRTP encryption and an ordered control DataChannel.
  It uses the ICE servers supplied by the authenticated coordinator. Current server configuration supplies STUN;
  this feature requires a working peer-to-peer media path. It does not tunnel video through the chat WebSocket
  relay. Networks that block peer connectivity show a bounded connection timeout.
- Android receives encrypted media directly in native libwebrtc. Decryption, jitter buffering and decoding
  run on native WebRTC threads; `RTCView` renders through `SurfaceViewRenderer`. JavaScript receives only stream
  handles, low-frequency statistics and small control messages. It never receives video frames/base64 data.
  The sender prefers H.264 for Android's native hardware decoder and retains negotiated native software fallback.
- Windows GDI capture, resizing, JPEG encoding and SendInput run through asynchronous Tauri commands on
  `spawn_blocking` workers. Binary frame IPC feeds the desktop canvas capture track. Capture is single-flight;
  the capture/encoding overhead can make achieved FPS lower than the configured cap.
- Network sampling uses WebRTC bandwidth, RTT, loss and encoder limitation feedback. Automatic mode starts at
  1280 pixels / 24 FPS, reduces load promptly and requires three healthy samples before increasing it. Manual
  FPS accepts integers from 1 to 144 and is independent of image-quality mode; it is an upper limit, not a guarantee.

## Controls and lifecycle

The floating mouse provides left/right buttons, scroll arrows, a relative touchpad and a relocation handle.
Long-press the left button to latch a drag and press it again to release. Tapping the touchpad clicks.
The keyboard sends Unicode text and common keys; Windows shortcuts show the desktop and Task View.
Native rotation and Web responsive layouts retain the same controls. Display panels stay within 400 px.

Only one remote desktop may own a host at a time. Control queues are bounded and coalesce pointer motion while
preserving button ordering. Closing the viewer, hiding the app/page, losing its chat session or missing the
control heartbeat stops capture. A separate native 15-second lease releases mouse buttons if the desktop
WebView disappears. Input validation rejects nonfinite/out-of-range coordinates and oversized text/wheel data.
The current implementation does not capture audio, elevate input into protected Windows prompts, select
additional monitors or change the host's display resolution.

## Verification

```powershell
npx vitest run src/remoteDesktop src/remoteChat/guiTools.test.ts src/remoteChat/hostRecovery.test.ts
# Run the command above from apps/desktop.
npm run test:remote-desktop:e2e -w @codex-switch/web
npm run check -w @codex-switch/native
npm run export:android -w @codex-switch/native
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test codex_switch_lib_tests
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --tests -- -D warnings
```

The browser fixture substitutes only Tauri capture/input IPC; it exercises the production sender, receiver,
WebRTC connection and control channel. Screenshots cover portrait, landscape and desktop layouts.
`apps/desktop/e2e/android-remote-desktop.mjs` drives the installed release APK on a disposable emulator.
Start `mobile-fixture.mjs` with `CHAT_TEST_REMOTE_DESKTOP=1`, `CHAT_TEST_API_PORT=1498` and
`CHAT_TEST_UI_PORT=1486`. Use `ANDROID_CHAT_DISPOSABLE=1`, `ANDROID_SERIAL` pointing at that disposable emulator,
`CHAT_TEST_API_PORT=1498` and `ANDROID_CHAT_OUTPUT=remote-desktop-android` when running the Android test.
The test installs the APK and clears only its disposable emulator's app data. Never point it at a physical phone
or an emulator containing user data.
