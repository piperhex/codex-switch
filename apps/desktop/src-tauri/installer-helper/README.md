# Windows installer helper

The helper runs during installation, upgrade, and removal, including on machines
without the Visual C++ Redistributable. It must statically link the MSVC runtime.

From the repository root, build and check the resulting executable with:

```powershell
node scripts/build-installer-helper.mjs
node scripts/build-installer-helper.mjs --target aarch64-pc-windows-msvc
node scripts/check-installer-helper.mjs
```

The build script preserves inherited Rust flags, enforces static CRT linkage,
and rejects direct or delayed Visual C++ runtime DLL imports in the executable.
Use `--debug` when building the installer test fixture.

For direct Cargo commands, run from this directory with an explicit target,
for example `cargo build --locked --release --target x86_64-pc-windows-msvc`.
The target keeps static CRT flags away from host-side procedural macros.
Building through `--manifest-path` from another directory does not load this
crate's `.cargo/config.toml`; use the repository script in that case.
