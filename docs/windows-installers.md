# Windows installers

The EXE installer uses Windows Restart Manager through NSIS's System plugin. It
does not embed or execute `csw-installer-helper.exe`, and neither the application
nor the installer requires the Visual C++ Redistributable.

Shutdown is scoped to this installation's executable path. After closing the old
process, the installer moves its executable into `.csw-installer-backup` and closes
any process that raced the first shutdown. Removing the original path prevents
launchers from restarting the old image during replacement. A marked backup and
exclusive Windows file handle support failure recovery and reject concurrent
installers for the same directory. A later attempt recovers an interrupted
replacement; unmarked user files are preserved. This recovery covers the main
executable, not a transaction over every installed file.

MSI retains the embedded helper with a statically linked runtime. Native MSI
Restart Manager alone allowed a relaunched old process to survive an otherwise
successful upgrade and left rollback files requiring a reboot. WiX's process-name
shutdown also cannot isolate another installation directory. Removing the MSI
helper requires a separate design that preserves these protections.

## Regression checks

On Windows with the Tauri NSIS and WiX 3 tools installed:

```powershell
node --test scripts/build-installer-helper.test.mjs scripts/verify-windows-runtime.test.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-windows-installer.ps1
```

Use `-WixRoot` and `-NsisCompiler` to select other compiler installations. The
script builds a dependency-free, static-runtime process fixture with no shutdown
protocol. MSI tests install a helper-free legacy product and perform a real major
upgrade using the current embedded helper. NSIS tests cover installation, running
upgrades, uninstall, isolation from another directory, relaunch attempts,
concurrent installers, failure before/after replacement, interrupted-install
recovery, and preservation of unmarked files. The suite works in Windows
PowerShell 5.1 and PowerShell 7. GitHub runs it in `windows-installer.yml`.

## Historical release verification, 2026-09-12

Windows 11 VM checks used actual GitHub release installers, with SHA256 matching
the official release asset digests. The old application was running at upgrade
time. The profile was backed up before testing.

| Baseline | Helper in old EXE | Upgrade to 1.5.1 | Old process closed | New window responsive |
| --- | --- | --- | --- | --- |
| 1.3.15 | No | Exit 0 | Yes | Yes |
| 1.4.14 | No | Exit 0 | Yes | Yes |

1.4.14 is the last public release without the helper. The helper was introduced
before tag 1.4.15, which has no public release; the downloaded 1.4.16 archive
contains it. Archive inspection was performed for all three releases; actual VM
upgrade checks in this table cover the two helper-free releases.

The final EXE archive contains no installer helper. Both upgrades retained login
state and the existing account list. `vcruntime140.dll` remained absent from
System32. Defender antivirus and real-time protection remained enabled; a custom
scan found no new detections for this final EXE. This is an observation of that
package and scan, not a guarantee about future antivirus classifications.

Verified SHA256 values:

```text
1.3.15 release EXE: 623a17bc875df91b7e1b14f3651ff4e3f7c9c158f5facd749e41852603c83095
1.4.14 release EXE: 50f1b457129f0d7e8fa9e79c427302365c1c81affaaafea0a13ff4813da6078f
1.4.16 release EXE: dc70f2f1e0480ffdc3e9defefd916d5162cb2faced38953d2c0ddbfc24037438
Tested 1.5.1 EXE:  a10acf599fa80eee9b127dbfd32f2238750fa76f63e07c5bb00b6d5e7f4bb0a5
```

The tested local packages were built with `--no-sign`; publishing signed release
assets remains a separate release operation.
