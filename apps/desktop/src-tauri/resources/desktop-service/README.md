# Windows unattended desktop runtime

`scripts/prepare-desktop-service.mjs` bundles the dedicated host and installs a checksum-pinned Node.js runtime here.
Generated executables, bundled JavaScript and third-party notices are build artifacts. The installer verifies their
hashes against a manifest embedded in the application before placing them in its administrator-owned service directory.

Build desktop packages through `npm run build:app`; ordinary source checks do not download this optional runtime.
