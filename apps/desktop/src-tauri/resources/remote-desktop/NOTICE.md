# Desktop video runtime

Windows native streaming uses a separate LGPL shared FFmpeg build. No FFmpeg library is linked
into Codex Switch. The runtime is prepared by `scripts/prepare-remote-desktop-runtime.mjs` and its
archive is verified with SHA-256 before extraction. The binary and shared libraries retain their
original licenses; `runtime/LICENSE.txt` accompanies packaged installations.

- Build: BtbN `autobuild-2026-08-31-13-27`, FFmpeg `n8.1.2-50-g1a748fe2cd`, Windows x64 LGPL shared.
- [Build scripts and dependency source references](https://github.com/BtbN/FFmpeg-Builds/tree/autobuild-2026-08-31-13-27)
- [Corresponding FFmpeg source](https://github.com/FFmpeg/FFmpeg/tree/1a748fe2cd)
- [Build archive and checksums](https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-08-31-13-27)

`runtime/` contains generated third-party artifacts and is excluded from Git. Release builders
must run the preparation script before packaging. Unsupported hosts retain the existing capture path.
