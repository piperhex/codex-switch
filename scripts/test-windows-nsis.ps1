param(
    [Parameter(Mandatory)][string]$TestRoot,
    [Parameter(Mandatory)][string]$InstallRoot,
    [Parameter(Mandatory)][string]$FixtureBinary
)
$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
$hooks = Join-Path $repository 'apps/desktop/src-tauri/windows/installer-hooks.nsh'
$compiler = Join-Path $env:LOCALAPPDATA 'tauri/NSIS/makensis.exe'
$installer = Join-Path $TestRoot 'fixture-setup.exe'
$source = @'
Unicode true
!include "LogicLib.nsh"
Name "Codex Switch Installer Test"
OutFile "INSTALLER_PATH"
RequestExecutionLevel user
SilentInstall silent
SilentUnInstall silent
!macro CheckIfAppIsRunning executableName productName
!macroend
!include "HOOK_PATH"
Section
  !insertmacro CheckIfAppIsRunning "csw.exe" "Codex Switch"
  SetOutPath "$INSTDIR"
  File /oname=csw.exe "FIXTURE_BINARY"
  WriteUninstaller "$INSTDIR\uninstall.exe"
  !insertmacro NSIS_HOOK_POSTINSTALL
SectionEnd
Section "Uninstall"
  !insertmacro CheckIfAppIsRunning "csw.exe" "Codex Switch"
  Delete "$INSTDIR\csw.exe"
  !insertmacro NSIS_HOOK_POSTUNINSTALL
SectionEnd
'@
$source = $source.Replace('INSTALLER_PATH', $installer).Replace('HOOK_PATH', $hooks)
$source = $source.Replace('FIXTURE_BINARY', $FixtureBinary)
$sourcePath = Join-Path $TestRoot 'fixture.nsi'
[IO.File]::WriteAllText($sourcePath, $source)
& $compiler /V2 $sourcePath
if ($LASTEXITCODE) { throw 'NSIS fixture compilation failed.' }

function Invoke-TestNsis([string]$Executable, [string]$Arguments) {
    $process = Start-Process $Executable -ArgumentList $Arguments -WindowStyle Hidden -PassThru
    try {
        if (-not $process.WaitForExit(30000)) {
            $process.Kill()
            $process.WaitForExit()
            throw 'NSIS fixture timed out.'
        }
        if ($process.ExitCode -ne 0) { throw "NSIS returned $($process.ExitCode)." }
    } finally { $process.Dispose() }
}

$children = @()
try {
    New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
    Copy-Item -LiteralPath $FixtureBinary -Destination (Join-Path $InstallRoot 'csw.exe')
    $children += Start-Process (Join-Path $InstallRoot 'csw.exe') -ArgumentList 'fixture','stubborn' `
        -WindowStyle Hidden -PassThru
    Invoke-TestNsis $installer "/S /D=$InstallRoot"
    if (-not $children[0].HasExited) { throw 'NSIS left its old application running.' }
    Write-Output 'PASS NSIS replaces a running legacy application.'
    $children += Start-Process (Join-Path $InstallRoot 'csw.exe') -ArgumentList 'fixture','cooperative' `
        -WindowStyle Hidden -PassThru
    Start-Sleep -Milliseconds 300
    if ($children[1].HasExited) { throw 'NSIS left the startup gate active after success.' }
    Invoke-TestNsis (Join-Path $InstallRoot 'uninstall.exe') "/S _?=$InstallRoot"
    if (-not $children[1].HasExited) { throw 'NSIS uninstall left its application running.' }
    if (Test-Path -LiteralPath (Join-Path $InstallRoot 'csw.exe')) { throw 'NSIS did not remove its application.' }
    Write-Output 'PASS NSIS releases the startup gate and closes the application on uninstall.'
} finally {
    foreach ($child in $children) {
        if (-not $child.HasExited) { $child.Kill(); $child.WaitForExit() }
        $child.Dispose()
    }
}
