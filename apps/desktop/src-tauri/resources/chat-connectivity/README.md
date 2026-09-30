# Chat connectivity

Session-scoped EasyTier integration for desktop, the Windows unattended service, Android and iOS.
Uses userspace TCP over the encrypted overlay; never creates a TUN device, changes host routes, or exposes arbitrary
application ports. Browsers continue to use WebRTC and the existing encrypted WebSocket fallback.

The native engine is pinned to EasyTier commit `ed73d318bb3bf19601e227ab83dd61d66ce4b9f8`.
`Cargo.lock` pins transitive dependencies. Desktop has a separate lockfile which must be updated with this crate.
See [upstream source](https://github.com/EasyTier/EasyTier/tree/ed73d318bb3bf19601e227ab83dd61d66ce4b9f8).

## Build

Install Rust 1.96.1 or newer and Protobuf (`protoc`). On Windows, put 7-Zip on PATH as well; upstream's Windows
compatibility-library build uses it. Linux requires a C compiler and CMake. Run:

```sh
cargo fmt --manifest-path crates/chat-connectivity/Cargo.toml --check
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
- Closing the owner cancels discovery, sockets and mapping leases. Native queues and frame sizes are bounded.

## Dependency notices

Our adapter is Apache-2.0. EasyTier is LGPL-3.0; its license is included in `LICENSE-EasyTier` and the exact source is
linked above. Builds retain the upstream dependency rather than copying its implementation into the adapter.
The repository, lockfiles and build scripts provide the corresponding source/build inputs for relinking.
Include this notice and the dependency license with distributed native binaries.
