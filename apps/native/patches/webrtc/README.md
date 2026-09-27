# Android VPN ICE address repair

Applies only to `react-native-webrtc` **124.0.8**, tested with its Android
`org.jitsi:webrtc:124.0.0` artifact. Both native chat and remote desktop use this adapter.
The package version is pinned; review this patch when upgrading WebRTC.

On the tested Android 14 Xiaomi phone, Clash Meta's VPN makes WebRTC advertise
the VPN interface address for a socket bound to Wi-Fi. The peer cannot reach that
socket using the advertised address, even with Clash's private-network bypass enabled.
An isolated probe confirmed that correcting only that candidate's address restores
a working data channel while the VPN remains active.

M124's `PhysicalSocket::Bind` binds the socket to a network and then binds to ANY.
`UDPPort::MaybeSetDefaultLocalAddress` substitutes the default network's address.
The normal JNI `NativeToJavaIceCandidate` callback passes adapter type `0`, so
`IceCandidate.adapterType` is UNKNOWN and cannot identify the Wi-Fi candidate.
The local-candidate stats retain `networkType` and `vpn`.

## Scope and safeguards

- Only inspect UDP host candidates advertising an IPv4 address of a current VPN network.
- Match local stats by address, port, priority, protocol and host candidate type.
- Require one matching Wi-Fi/Ethernet candidate, without `vpn=true`, and one usable
  IPv4 address of the corresponding physical network type.
- Keep actual VPN, cellular, srflx, relay, TCP, IPv6 and mDNS candidates unchanged.
  Missing or ambiguous metadata also keeps the original candidate.
- Change only the outgoing trickle ICE event. Do not bind the process to another
  network, alter sockets, request permissions or override VPN routing policy.
- Query stats asynchronously; return to the existing WebRTC executor before
  emitting the event. Discard callbacks whose peer has since been disposed.
- The original local SDP is unchanged. This patch assumes the existing trickle ICE
  flow; a future non-trickle flow needs a separate review.

`scripts/patch-webrtc-ice.cjs` runs in native `postinstall`, checks the exact package
version and source anchors, preserves line endings, and supports repeated execution.
It validates both upstream source files before editing either one. Only the two
production helpers are copied into the dependency; the test class is excluded.

## Verification

From the repository root, with JDK 17+ available through `JAVA_HOME` or `PATH`:

```sh
node apps/native/scripts/patch-webrtc-ice.cjs
node apps/native/scripts/test-webrtc-ice.cjs
npm run test -w @codex-switch/native -- scripts/patch-webrtc-ice.test.ts
npm run check -w @codex-switch/native
npm run build:apk -w @codex-switch/native
```

Run the real-device VPN on/off procedure and review limitations in
[the investigation report](../../../../docs/p2p-investigation-20260927.md).

Upstream references:

- [PhysicalSocket::Bind](https://github.com/jitsi/webrtc/blob/M124/rtc_base/physical_socket_server.cc)
- [UDPPort address substitution](https://github.com/jitsi/webrtc/blob/M124/p2p/base/stun_port.cc)
- [JNI candidate conversion](https://github.com/jitsi/webrtc/blob/M124/sdk/android/src/jni/pc/ice_candidate.cc)
