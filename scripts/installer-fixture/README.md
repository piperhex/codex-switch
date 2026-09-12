# Windows installer test process

This dependency-free process is used only by the native installer regression tests.
It is never included in the application or its installers.

Run `node scripts/check-installer-fixture.mjs` from the repository root to check
formatting, run Clippy, build, and verify the executable's runtime imports. An
explicit MSVC target can be selected with `--target x86_64-pc-windows-msvc`.

The output is `target/<target>/debug/csw-installer-fixture.exe` in this directory.
Tests copy it to an isolated installation directory as `csw.exe` and start it
without arguments. `--chrome-plugin-native-host` also keeps the process alive,
allowing tests to represent a background native host. Both modes have no window,
shutdown handler, startup gate, or installer protocol.

The fixture stays idle until the installer closes it or the test cleans it up.
Its CRT is linked statically so missing runtime DLLs cannot invalidate a shutdown test.
