param(
    [Parameter(Mandatory)][string]$TestRoot,
    [Parameter(Mandatory)][string]$InstallRoot,
    [Parameter(Mandatory)][string]$FixtureBinary,
    [string]$Compiler
)
$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
$hooks = Join-Path $repository 'apps/desktop/src-tauri/windows/installer-hooks.nsh'
if (-not $Compiler) { $Compiler = Join-Path $env:LOCALAPPDATA 'tauri/NSIS/makensis.exe' }
$installer = Join-Path $TestRoot 'fixture-setup.exe'
$failedInstaller = Join-Path $TestRoot 'fixture-failed-setup.exe'
$InstallRoot = Join-Path $InstallRoot 'NSIS application with spaces'
$helper = Join-Path $InstallRoot 'csw-installer-helper.exe'
$source = @'
Unicode true
!include "LogicLib.nsh"
Name "Codex Switch Installer Test"
!ifndef CSW_TEST_OUTPUT
  !define CSW_TEST_OUTPUT "INSTALLER_PATH"
!endif
OutFile "${CSW_TEST_OUTPUT}"
RequestExecutionLevel user
SilentInstall silent
SilentUnInstall silent
!macro CheckIfAppIsRunning executableName productName
!macroend
!include "HOOK_PATH"
!macro VerifyNoInstallerHelper
  ${If} ${FileExists} "$INSTDIR\csw-installer-helper.exe"
    Abort "The installer extracted an unexpected helper executable."
  ${EndIf}
!macroend
Section
  !insertmacro CheckIfAppIsRunning "csw.exe" "Codex Switch"
  !insertmacro VerifyNoInstallerHelper
  !ifdef CSW_TEST_PAUSE_AFTER_SHUTDOWN
    FileOpen $0 "$INSTDIR\.csw-test-shutdown-ready" w
    FileWrite $0 "ready"
    FileClose $0
    Sleep 1500
  !endif
  !ifdef CSW_TEST_FAILURE
    SetErrorLevel 2
    Abort "Simulated installation failure."
  !endif
  SetOutPath "$INSTDIR"
  File /oname=csw.exe "FIXTURE_BINARY"
  !ifdef CSW_TEST_FAILURE_AFTER_COPY
    SetErrorLevel 2
    Abort "Simulated failure after replacing the executable."
  !endif
  WriteUninstaller "$INSTDIR\uninstall.exe"
  !insertmacro NSIS_HOOK_POSTINSTALL
  ${If} $CswRmSessionActive == 1
    Abort "The installer did not release its shutdown session."
  ${EndIf}
SectionEnd
Section "Uninstall"
  !insertmacro CheckIfAppIsRunning "csw.exe" "Codex Switch"
  !insertmacro VerifyNoInstallerHelper
  Delete "$INSTDIR\csw.exe"
  !insertmacro NSIS_HOOK_POSTUNINSTALL
  ${If} $CswRmSessionActive == 1
    Abort "The uninstaller did not release its shutdown session."
  ${EndIf}
SectionEnd
'@
$source = $source.Replace('INSTALLER_PATH', $installer).Replace('HOOK_PATH', $hooks)
$source = $source.Replace('FIXTURE_BINARY', $FixtureBinary)
$sourcePath = Join-Path $TestRoot 'fixture.nsi'
[IO.File]::WriteAllText($sourcePath, $source)
& $Compiler /V2 $sourcePath
if ($LASTEXITCODE) { throw 'NSIS fixture compilation failed.' }
& $Compiler /V2 /DCSW_TEST_FAILURE "/DCSW_TEST_OUTPUT=$failedInstaller" $sourcePath
if ($LASTEXITCODE) { throw 'NSIS failure fixture compilation failed.' }

function Invoke-TestNsis([string]$Executable, [string]$Arguments, [int]$ExpectedExitCode = 0) {
    $process = Start-Process $Executable -ArgumentList $Arguments -WindowStyle Hidden -PassThru
    try {
        if (-not $process.WaitForExit(30000)) {
            $process.Kill()
            $process.WaitForExit()
            throw 'NSIS fixture timed out.'
        }
        if ($process.ExitCode -ne $ExpectedExitCode) { throw "NSIS returned $($process.ExitCode)." }
    } finally { $process.Dispose() }
    if (Test-Path -LiteralPath $helper) { throw 'NSIS left its helper executable behind.' }
}

$children = @()
try {
    Invoke-TestNsis $installer "/S /D=$InstallRoot"
    if (-not (Test-Path -LiteralPath (Join-Path $InstallRoot 'csw.exe'))) {
        throw 'NSIS did not install its application.'
    }
    Write-Output 'PASS NSIS installs into a new directory without extracting a helper.'
    $children += Start-Process (Join-Path $InstallRoot 'csw.exe') -WindowStyle Hidden -PassThru
    Invoke-TestNsis $installer "/S /D=$InstallRoot"
    if (-not $children[0].HasExited) { throw 'NSIS left its old application running.' }
    Write-Output 'PASS NSIS replaces a running legacy application.'
    $children += Start-Process (Join-Path $InstallRoot 'csw.exe') -ArgumentList '--chrome-plugin-native-host' `
        -WindowStyle Hidden -PassThru
    Start-Sleep -Milliseconds 300
    if ($children[1].HasExited) { throw 'NSIS did not permit startup after success.' }
    Invoke-TestNsis $failedInstaller "/S /D=$InstallRoot" -ExpectedExitCode 2
    if (-not $children[1].HasExited) { throw 'NSIS failure fixture did not close its application.' }
    $children += Start-Process (Join-Path $InstallRoot 'csw.exe') -WindowStyle Hidden -PassThru
    Start-Sleep -Milliseconds 300
    if ($children[2].HasExited) { throw 'NSIS did not permit startup after failure.' }
    Write-Output 'PASS NSIS leaves no helper and permits startup after failure.'
    Invoke-TestNsis (Join-Path $InstallRoot 'uninstall.exe') "/S _?=$InstallRoot"
    if (-not $children[2].HasExited) { throw 'NSIS uninstall left its application running.' }
    if (Test-Path -LiteralPath (Join-Path $InstallRoot 'csw.exe')) { throw 'NSIS did not remove its application.' }
    Write-Output 'PASS NSIS closes the application on uninstall and releases its shutdown session.'
    & "$PSScriptRoot/test-windows-nsis-recovery.ps1" -TestRoot $TestRoot -InstallRoot $InstallRoot `
        -FixtureBinary $FixtureBinary -Compiler $Compiler
} finally {
    foreach ($child in $children) {
        if (-not $child.HasExited) { $child.Kill(); $child.WaitForExit() }
        $child.Dispose()
    }
}
