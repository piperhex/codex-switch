# Damage-aware desktop capture validation

Validated locally on 2026-09-27. These measurements describe development builds, not a published release.

## Scope

The Windows helper reads WGC `DirtyRegions` on supported systems. Damage survives FPS throttling;
unchanged frames skip GPU scaling/conversion, encoding and sending. `ReportOnly` supplies complete
surfaces, so skipped capture frames never require reconstructing potentially missing rectangles.
GDI fallback compares BGRA rows exactly, including single-channel one-level pixel changes, before
conversion/encoding. GDI still pays for capture and comparison. Existing FFmpeg GPU fallback remains
available on systems without the WGC dirty-region API; that compatibility path is not damage-aware.

Updates retain standard H.264/WebRTC. This is not a rectangle-patch protocol or partial-frame hardware
encoding. Native Android/iOS and Web do not need a different receiver. Active full-screen animation
does not have a promised bandwidth reduction. A two-second recovery refresh bounds idle recovery.

## Controlled scene measurements

`node scripts/test-desktop-damage.mjs` builds the helper, creates a dedicated 640 × 360 test window,
and uses the same capture and encoder with damage gating enabled/disabled. Each scene lasts three
seconds at a 60 FPS cap and 3 Mbps configured ceiling. The baseline also uses variable bitrate, so
the comparison isolates damage gating rather than a CBR/VBR change. Numbers count H.264 payload
bytes, excluding WebRTC, TURN and network overhead. They are sample results, not general guarantees.

| Scene / backend | Baseline payload | Damage-aware payload | Reduction |
| --- | ---: | ---: | ---: |
| Idle after animation / WGC + NVENC | 6,986 bytes | 3,002 bytes | 57% |
| Small changing rectangle / WGC + NVENC | 7,620 bytes | 3,808 bytes | 50% |
| Idle after animation / GDI + OpenH264 | 5,438 bytes | 2,510 bytes | 54% |
| Small changing rectangle / GDI + OpenH264 | 5,209 bytes | 1,977 bytes | 62% |

The idle scene sent two recovery/update frames instead of 160–174 repeated frames. Local changes
sent 15 frames instead of 160–173. Full animation retained 90 actual updates; payload was roughly
unchanged (about 144–149 KB for NVENC, 125–126 KB for OpenH264). Hardware first output arrived in
about 308 ms; software first output in about 39 ms. These are helper startup/output timings, not
phone input-to-display latency.

The test decodes the real output and checks a color marker, a small update after idle, and its later
erasure. A second decoder discards all earlier video and starts during the idle period; it recovers
from repeated SPS/PPS and IDR data, then displays the later update and erasure. Packet parsing tests
cover split reads, multiple packets, invalid lengths, and the final
frame without a subsequent frame. Damage-policy tests check pending changes across throttling and
exact tiny edits/erasure. RTP tests use the real H.264 packetizer to verify idle timestamp gaps without
sending padding packets or inventing sequence-number loss.

The separate opt-in native-to-Edge test runs capture → helper → Rust WebRTC → actual browser decoder.
Set `CSW_NATIVE_TEST_REQUIRE_DAMAGE=1` to forbid the legacy compatibility encoder from masking failure.
Web portrait/landscape/desktop controls and playback regression tests pass. Native mobile TypeScript
compatibility passes; this task does not claim a new physical-phone performance measurement.

## Reproduction

The helper requires Visual Studio 2022 C++, Windows SDK 10.0.26100.0, CMake, and the checksum-pinned
FFmpeg SDK/runtime prepared by `scripts/prepare-remote-desktop-runtime.mjs`. CMake enables `/W4 /WX`,
uses the static MSVC runtime, and runs the pure damage-policy test. Its interactive fixture is kept
outside packaged resources and only captures its own window. Window display never requests focus.

Run the commands in [remote-desktop.md](remote-desktop.md#verification). The GPU comparison requires
a working WGC dirty-region API and hardware encoder; it fails explicitly when unavailable instead
of silently reporting software or legacy results as GPU damage measurements.
