# Codex Switch mixed symmetric NAT fallback

Upstream: <https://github.com/EasyTier/EasyTier/tree/ed73d318bb3bf19601e227ab83dd61d66ce4b9f8/easytier-core>.
This directory retains the upstream LGPL-3.0 license. `Cargo.toml` expands the upstream workspace dependencies;
`easytier-proto` still points to the same Git revision. Existing upstream files and tests are retained to keep the
patch reviewable and upgradable; their pre-existing size/style is not an invitation to refactor unrelated code.

## Behavior

Upstream skips UDP punching between `Symmetric` and `SymmetricEasyInc` / `SymmetricEasyDec`.
`udp/common.rs` now selects `HardSymToEasySym`, with only the hard side initiating. Disabled P2P, disabled symmetric
punching, public-node exclusions, existing direct links, authentication, and session cancellation still apply.
Hard/hard and symmetric UDP firewall combinations remain unsupported by this fallback.

`udp/mixed.rs` rotates through 16 sockets × 256 predicted ports, 8 × 512, and 4 × 1024 on failed attempts.
The wider windows tolerate larger easy-side mapping drift while keeping the same 4,096 mapping budget; the cycle
returns to the focused window to retain socket diversity. It uses the existing authenticated
`select_punch_listener` / `send_punch_packet_hard_sym` RPCs to
ask that side to probe random hard-side ports. The peer's observed packet source and the original punched socket
are retained for the transport handshake. A STUN mapping or receipt of a punch packet alone is never marked direct;
the existing encrypted peer admission and one-hop route checks remain authoritative.

The fallback is probabilistic: a monotonic peer mapping must intersect an existing hard-side mapping. Interleaved
traffic, large mapping strides, IP-dependent exits, finite NAT tables, firewalls, or random mappings on both sides
may defeat it. No universal success rate or parity with another product is claimed.

Each attempt lasts at most 10 seconds and sends at most 12,288 small local probe datagrams (4,096 distinct mappings).
The legacy remote RPC's round-8 budget limits it to at most 200 destinations per pass (rounded up for two public IPs),
two passes, at most two public IPs;
its existing triple-packet sending and pacing are unchanged. Retries wait 1, 10, 30, then 60 seconds, including after
RPC failures. All socket-array tasks and the outbound RPC are canceled with the attempt. Remote RPC work is bounded
by the existing server implementation. Failed native discovery continues to use the existing WebSocket relay.

The peer and coordinator protocols are unchanged. Updating the hard-side native client is sufficient to initiate
this fallback with a compatible old easy-side client. Desktop, its unattended service, Android and iOS use the same
crate; ordinary browsers cannot open these raw UDP sockets and retain WebRTC plus WebSocket relay.

## Scope and tests

- `udp/common.rs`, `udp/connector.rs`, `udp/mod.rs`, `udp/task.rs`: strategy selection, scheduling and regression tests.
- `udp/mixed.rs`, `udp/mixed_budget.rs`, `udp/mixed_tests.rs`: bounded probes, rotating prediction windows,
  source validation and deterministic endpoint-dependent NAT emulation, incremental/decremental mappings,
  mapping drift, bidirectional data, deadlines, cancellation, rejection and exhausted attempts.
- Feature guards in `instance/manager.rs`, `instance/tests.rs`, `config/toml.rs`, `process_runtime.rs`, and
  `tunnel/encrypt/mod.rs` allow the retained upstream tests and the minimal native feature set to compile cleanly.

Run the hole-punch tests from the parent workspace with `--no-default-features` and
`--features aes-gcm,proxy-smoltcp-stack,tcp-hole-punch`; the native connectivity CI does this on Windows, Linux and macOS.
The simulator validates packet filtering and socket reuse; it is not a real carrier-network success-rate test.
Replace this patch when upstream provides an equivalent bounded mixed-NAT strategy, retaining its regression tests.

## STUN Max comparison

Reviewed [uk0/stun_max at adc74688](https://github.com/uk0/stun_max/blob/adc74688ffdcebd0df1d978a52e908c748652d3c/client/core/stun.go).
Its multi-socket probing, wider port prediction and relay retries informed the comparison; no STUN Max source is
included in this patch. Its advertised NAT3/NAT4 success rate does not establish a rate for two symmetric NATs.
In that revision, `attemptHolePunch` sends on auxiliary sockets then closes them, while `udpReadLoop` receives on
the main socket. That does not preserve a successful auxiliary mapping for endpoint-dependent filters. Its drift
model is local, so it is not reliable evidence of the remote NAT's allocation pattern. Our fallback instead keeps
the punched socket and observed remote tuple, validates a normal transport, and uses bounded prediction windows
without pretending to know a remote drift rate. This is not a full port or replacement of STUN Max.
