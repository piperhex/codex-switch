# Chat connectivity

Session-scoped EasyTier integration for desktop, the Windows unattended service, Android and iOS.
Uses userspace TCP over the encrypted overlay; never creates a TUN device, changes host routes, or exposes arbitrary
application ports. Browsers continue to use WebRTC and the existing encrypted WebSocket fallback.

The native engine is pinned to EasyTier commit `ed73d318bb3bf19601e227ab83dd61d66ce4b9f8`.
`Cargo.lock` pins transitive dependencies. Desktop has a separate lockfile which must be updated with this crate.
See [upstream source](https://github.com/EasyTier/EasyTier/tree/ed73d318bb3bf19601e227ab83dd61d66ce4b9f8).
The `easytier-core` package is vendored with a bounded mixed symmetric NAT fallback; see
[patch notes](vendor/easytier-core/CODEX_SWITCH_PATCH.md). Both Cargo roots select the same patched package.

## Build

Install Rust 1.96.1 or newer and Protobuf (`protoc`). On Windows, put 7-Zip on PATH as well; upstream's Windows
compatibility-library build uses it. Linux requires a C compiler and CMake. Run:

```sh
cargo fmt --manifest-path crates/chat-connectivity/Cargo.toml --all --check
cargo test --locked --manifest-path crates/chat-connectivity/Cargo.toml -p easytier-core \
  --no-default-features --features aes-gcm,proxy-smoltcp-stack,tcp-hole-punch connectivity::hole_punch --lib
cargo test --locked --manifest-path crates/chat-connectivity/Cargo.toml
cargo clippy --locked --manifest-path crates/chat-connectivity/Cargo.toml --all-targets -- -D warnings
```

Android additionally needs the React Native NDK and `cargo install cargo-ndk --version 4.1.2 --locked`.
Expo's chat connectivity plugin registers the JNI module and a Gradle task which builds every requested ABI.
The APK verifier checks `libcsw_chat_connectivity.so` in all four release ABIs. iOS builds a static XCFramework for
device arm64 and both simulator architectures during installation of the local CocoaPod. iOS requires macOS/Xcode.

## Session boundaries

- Both endpoints must advertise native connectivity before admin-go provides the configuration.
- Each session has a distinct network name and HMAC-derived secret. Signaling reconnects preserve these credentials.
- Desktop commands obtain endpoints and credentials from the authenticated Rust signaling worker; JavaScript supplies
  only a session ID. The installed service child is trusted native code with a fixed parent RPC allowlist.
- Native expiry enforcement also works while JavaScript is suspended. Authenticated renewal extends the same engine.
- Native readiness requires a direct, one-hop route and its selected direct connection. The configured rendezvous
  node disables application-data relaying. Existing WebSocket fallback retains its own relay accounting.
  Both punched and non-punched sockets qualify once the selected, open connection has a measured round trip.
  EasyTier's `directly_connected_conns` excludes punched sockets and must not be used as a P2P allowlist.
  Transport admission alone does not open the chat stream; diagnostics use the same verified connection check.
- Closing the owner cancels discovery, sockets and mapping leases. Native queues and frame sizes are bounded.

## Dependency notices

Our adapter is Apache-2.0. EasyTier is LGPL-3.0; its license is included in `LICENSE-EasyTier` and the exact source is
linked above. The modified core, its LGPL license, and patch notes are in `vendor/easytier-core`;
the host integration and protocol definitions retain the pinned upstream dependency.
The repository, lockfiles and build scripts provide the corresponding source/build inputs for relinking.
Include this notice and the dependency license with distributed native binaries.
