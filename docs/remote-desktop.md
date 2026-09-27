# Remote desktop

The phone and Web chat toolbox opens the selected computer's remote desktop. The first host implementation
supports the primary Windows display. macOS/Linux hosts return an explicit unsupported-platform message.
The viewer works on Android/iOS through `react-native-webrtc` and on Web through the browser's WebRTC engine.

## Media and threading

- The existing authenticated, end-to-end encrypted chat connection carries offer/answer, ICE and display settings.
  Host ownership is the individual chat session, not a client-supplied owner or the persistent terminal owner.
- A separate WebRTC connection carries video with DTLS/SRTP encryption and an ordered control DataChannel.
  It uses the ICE servers supplied by the authenticated coordinator. Optional TURN UDP/TCP/TLS supplies a media
  relay when direct connectivity fails. Chat WebSocket relay and video relay remain separate connections.
  The desktop overlay reports the selected video candidate route, independently of the chat's P2P/Relay label.
  See [video relay deployment](../apps/admin-go/DESKTOP-RELAY.md) for credentials, quotas and network requirements.
- Android receives encrypted media directly in native libwebrtc. Decryption, jitter buffering and decoding
  run on native WebRTC threads; `RTCView` renders through `SurfaceViewRenderer`. JavaScript receives only stream
  handles, low-frequency statistics and small control messages. It never receives video frames/base64 data.
  The sender prefers H.264 for Android's native hardware decoder and retains negotiated native software fallback.
- Windows first uses the native `desktop-video` helper: Graphics Capture dirty rectangles gate GPU conversion
  and H.264 encoding, preferring NVENC then Media Foundation. Complete `ReportOnly` surfaces preserve updates
  when capture frames are coalesced. D3D11 scales/converts on the GPU without reading pixels through the CPU.
  Hardware encoders use variable bitrate; unchanged frames do not enter conversion, encoding or transmission.
- Native GDI/OpenH264 fallback uses exact BGRA row comparisons before color conversion/encoding. It still has
  to capture/compare the desktop, but skips unchanged video frames without a perceptual threshold that could
  miss tiny text edits. Machines without the new WGC API retain the existing FFmpeg hardware path before the
  GDI fallback. Unsupported/missing helper runtimes retain the original compatibility backends.
- A recovery frame is sent at most two seconds after the previous update, with periodic intra frames, so an
  idle desktop can recover from packet loss. Damage stays pending across FPS throttling. The helper outputs
  length-delimited access units with encoder buffering disabled; the final update does not wait for another
  captured frame. Rust buffers incomplete pipe reads across polling cancellation. RTP timestamps advance
  before a resumed frame, so idle time does not become playback delay on the following update.
- This is capture-side damage gating plus standard H.264 inter-frame compression, not a rectangle-patch wire
  protocol. Partial changes still produce a complete decodable video frame. Android/iOS native WebRTC and Web
  viewers keep their existing receivers and hardware-decoder compatibility. FPS can fall close to zero when
  idle without indicating a stalled connection. Frames remain outside WebView/JavaScript IPC.
- A checksum-pinned LGPL shared FFmpeg runtime is bundled by the desktop build script; the helper dynamically
  links its DLLs. Licenses, source references and helper rebuild instructions accompany it.
- Native video uses bounded queues, NACK/RTCP feedback and periodic keyframes. It reduces bitrate after loss
  or insufficient reported capacity and probes upward after three healthy samples. Capture stops while ICE
  connects, then restarts to discard startup backlog. Frame selection preserves source timing instead of
  padding a slow display with repeated frames. Native input runs on blocking workers with an expiring lease.
- Native automatic mode targets 1920 pixels / 60 FPS / 6 Mbps. Manual FPS accepts integers from 1 to 144 and is
  independent of image quality. These are limits, not guarantees: source refresh, GPU/CPU, decoder and network
  capacity all matter. Hyper-V's enhanced display can limit genuine capture to approximately 30 FPS even on a fast LAN.
- When the native runtime or capture is unavailable, the original GDI/JPEG → WebView canvas → browser WebRTC
  sender remains a compatibility fallback. Its automatic mode starts at 1280 pixels / 24 FPS and adapts to
  measured capture/network limits. Capture and input commands remain asynchronous and run off the UI thread.
- webrtc-rs 0.17 implements TURN/UDP gathering. A private loopback transport adapter supplies TURN/TCP and TLS
  framing without changing its authentication/allocation logic. TLS validates normal trust roots and the server
  name; there is no production option to disable verification. The adapter lifetime belongs to the stream.

## Controls and lifecycle

The viewer draws its own pointer immediately; all Windows capture paths exclude the host cursor.
The compact floating mouse follows that pointer and can extend into letterbox space around the video.
The 18 × 24 pointer stays at the upper-left of the 120 × 136 mouse panel. Controls keep a fixed offset
while the whole desktop pans when they reach the viewer edges, revealing black canvas.
At the bottom, the canvas opens at twice the swipe speed because the touchpad leaves less room for the finger.
This assistance stops at the margin needed to fit the panel at the desktop's bottom edge.
The translation stays unchanged on reverse motion or idle collapse, and resets on rotation
or a switch to direct touch. Cursor placement and video rendering share the translated rectangle. The native cursor image
has explicit layout dimensions so its 3x bitmap cannot enlarge it. Motion and direct touches use the actual contain-fit video rectangle.
The mouse provides left/right buttons, scroll arrows, a relative touchpad and a handle that moves the pointer and panel together.
Long-press the left button to latch a drag and press it again to release. Tapping the touchpad clicks.
After ten idle seconds the panel collapses to a round mouse icon; tapping it reopens the controls.
Held fingers, buttons and latched drags prevent automatic collapse.
The toolbar switches between mouse and direct-touch modes. Direct touches click or drag at the touched video position;
touches that start in the letterbox are ignored. Switching modes releases held buttons.
The keyboard sends Unicode text and common keys; Windows shortcuts show the desktop and Task View.
Native rotation and Web responsive layouts retain the same controls. Display panels stay within 400 px.

Only one remote desktop may own a host at a time. Control queues are bounded and coalesce pointer motion while
preserving button ordering. Closing the viewer, hiding the app/page, losing its chat session or missing the
control heartbeat stops capture. A separate native 15-second lease releases mouse buttons if the desktop
WebView disappears. Input validation rejects nonfinite/out-of-range coordinates and oversized text/wheel data.
The current implementation does not capture audio, elevate input into protected Windows prompts, select
additional monitors or change the host's display resolution.

## Verification

The [damage-aware capture validation](remote-desktop-damage-validation-20260927.md) records controlled
payload comparisons and the limits of this optimization.

The [1.6.2 physical-device investigation](remote-desktop-investigation-20260926.md) records measured
capture/playback limits, the missing media-relay path and references to mature open-source implementations.

```powershell
npx vitest run src/remoteDesktop src/remoteChat/guiTools.test.ts src/remoteChat/hostRecovery.test.ts
# Run the command above from apps/desktop.
npm run test:remote-desktop:e2e -w @codex-switch/web
npm run check -w @codex-switch/native
npm run export:android -w @codex-switch/native
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test codex_switch_lib_tests
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --tests -- -D warnings
# Build the native helper and compare controlled idle/local/full-motion scenes through a real H.264 decoder:
node scripts/test-desktop-damage.mjs
# Interactive Windows capture -> native H.264/WebRTC -> real Edge decoder (opt-in):
$env:CSW_NATIVE_TEST_REQUIRE_DAMAGE = '1'
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test codex_switch_lib_tests native_capture_reaches_a_real_browser_decoder -- --ignored --nocapture
Remove-Item Env:CSW_NATIVE_TEST_REQUIRE_DAMAGE
```

The browser fixture substitutes only Tauri capture/input IPC; it exercises the production sender, receiver,
WebRTC connection and control channel. Screenshots cover portrait, landscape and desktop layouts.
The Go media-relay integration suite also forces relay candidates through real coturn over UDP, TCP and TLS,
checks metered bytes, and can include the native Windows sender. Its temporary CA is accepted only in the Rust
test build. Decoder frame counts are throughput measurements; a moving source is required to judge motion quality.
`apps/desktop/e2e/android-remote-desktop.mjs` drives the installed release APK on a disposable emulator.
Start `mobile-fixture.mjs` with `CHAT_TEST_REMOTE_DESKTOP=1`, `CHAT_TEST_API_PORT=1498` and
`CHAT_TEST_UI_PORT=1486`. Use `ANDROID_CHAT_DISPOSABLE=1`, `ANDROID_SERIAL` pointing at that disposable emulator,
`CHAT_TEST_API_PORT=1498` and `ANDROID_CHAT_OUTPUT=remote-desktop-android` when running the Android test.
The test installs the APK and clears only its disposable emulator's app data. Never point it at a physical phone
or an emulator containing user data.
