param(
    [Parameter(Mandatory)][string]$TestRoot,
    [Parameter(Mandatory)][string]$InstallRoot,
    [Parameter(Mandatory)][string]$FixtureBinary,
    [Parameter(Mandatory)][string]$Compiler
)
$ErrorActionPreference = 'Stop'
$sourcePath = Join-Path $TestRoot 'fixture.nsi'
$installer = Join-Path $TestRoot 'fixture-setup.exe'
$failedInstaller = Join-Path $TestRoot 'fixture-failed-setup.exe'
$delayedInstaller = Join-Path $TestRoot 'fixture-delayed-setup.exe'
$failedCopyInstaller = Join-Path $TestRoot 'fixture-failed-copy-setup.exe'
$recoveryRoot = Join-Path $InstallRoot 'recovery'
$target = Join-Path $recoveryRoot 'csw.exe'
$backupRoot = Join-Path $recoveryRoot '.csw-installer-backup'
$backup = Join-Path $backupRoot 'csw.exe'
$marker = Join-Path $recoveryRoot '.csw-test-shutdown-ready'
& $Compiler /V2 /DCSW_TEST_PAUSE_AFTER_SHUTDOWN "/DCSW_TEST_OUTPUT=$delayedInstaller" $sourcePath
if ($LASTEXITCODE) { throw 'NSIS relaunch fixture compilation failed.' }
& $Compiler /V2 /DCSW_TEST_FAILURE_AFTER_COPY "/DCSW_TEST_OUTPUT=$failedCopyInstaller" $sourcePath
if ($LASTEXITCODE) { throw 'NSIS recovery fixture compilation failed.' }
New-Item -ItemType Directory -Path $recoveryRoot -Force | Out-Null

function Start-TestInstaller([string]$Path, [string]$Directory) {
    return Start-Process $Path -ArgumentList "/S /D=$Directory" -WindowStyle Hidden -PassThru
}

function Wait-TestExit([Diagnostics.Process]$Process, [int]$Expected = 0) {
    if (-not $Process.WaitForExit(30000)) { throw 'NSIS recovery fixture timed out.' }
    if ($Process.ExitCode -ne $Expected) { throw "NSIS returned $($Process.ExitCode), expected $Expected." }
}

function Wait-TestShutdown([Diagnostics.Process]$Process) {
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while (-not (Test-Path -LiteralPath $marker)) {
        if ($Process.HasExited) { throw "NSIS exited before pausing: $($Process.ExitCode)." }
        if ([DateTime]::UtcNow -gt $deadline) { throw 'NSIS did not reach its shutdown pause.' }
        Start-Sleep -Milliseconds 20
    }
}

function Write-LegacyExecutable {
    Copy-Item -LiteralPath $FixtureBinary -Destination $target -Force
    # PE loaders allow appended data; this distinguishes the old executable from its replacement.
    $stream = [IO.File]::Open($target, [IO.FileMode]::Append)
    $legacyMarker = [Text.Encoding]::UTF8.GetBytes('legacy executable marker')
    try { $stream.Write($legacyMarker, 0, $legacyMarker.Length) } finally { $stream.Dispose() }
    return (Get-FileHash -LiteralPath $target).Hash
}

function Assert-Recovered([string]$ExpectedHash) {
    if ((Get-FileHash -LiteralPath $target).Hash -ne $ExpectedHash) { throw 'NSIS did not restore the old executable.' }
    if (Test-Path -LiteralPath $backupRoot) { throw 'NSIS left its backup directory after recovery.' }
}

$children = [Collections.Generic.List[Diagnostics.Process]]::new()
try {
    $null = Write-LegacyExecutable
    $legacy = Start-Process $target -WindowStyle Hidden -PassThru
    $children.Add($legacy)
    $delayed = Start-TestInstaller $delayedInstaller $recoveryRoot
    $children.Add($delayed)
    Wait-TestShutdown $delayed
    if (-not $legacy.HasExited) { throw 'NSIS left the old executable running before replacement.' }
    for ($attempt = 0; $attempt -lt 3; $attempt++) {
        if (Test-Path -LiteralPath $target) { throw 'The old path remained available for relaunch.' }
        $relaunch = $null
        try {
            $relaunch = Start-Process $target -ArgumentList '--chrome-plugin-native-host' -WindowStyle Hidden -PassThru
        } catch [System.InvalidOperationException] {
            if (Test-Path -LiteralPath $target) { throw }
        }
        if ($relaunch) {
            $children.Add($relaunch)
            throw 'A browser could restart the old executable during replacement.'
        }
        Start-Sleep -Milliseconds 100
    }
    $competing = Start-TestInstaller $installer $recoveryRoot
    $children.Add($competing)
    Wait-TestExit $competing 2
    Wait-TestExit $delayed
    if (Test-Path -LiteralPath $backupRoot) { throw 'NSIS left its backup after replacing the application.' }
    Write-Output 'PASS NSIS blocks legacy relaunches during replacement and rejects a concurrent installer.'

    $legacyHash = Write-LegacyExecutable
    foreach ($failure in @($failedInstaller, $failedCopyInstaller)) {
        $process = Start-TestInstaller $failure $recoveryRoot
        $children.Add($process)
        Wait-TestExit $process 2
        Assert-Recovered $legacyHash
    }
    Write-Output 'PASS NSIS restores the original executable after failures before and after file replacement.'

    Remove-Item -LiteralPath $marker
    $interrupted = Start-TestInstaller $delayedInstaller $recoveryRoot
    $children.Add($interrupted)
    Wait-TestShutdown $interrupted
    $interrupted.Kill()
    $interrupted.WaitForExit()
    if (-not (Test-Path -LiteralPath $backup)) { throw 'The interrupted installer did not retain its recovery copy.' }
    $recovery = Start-TestInstaller $failedInstaller $recoveryRoot
    $children.Add($recovery)
    Wait-TestExit $recovery 2
    Assert-Recovered $legacyHash
    Write-Output 'PASS NSIS recovers the old executable on the next run after the installer is terminated.'

    New-Item -ItemType Directory -Path $backupRoot | Out-Null
    [IO.File]::WriteAllText($backup, 'A pre-existing user file, not an installer backup.')
    $userHash = (Get-FileHash -LiteralPath $backup).Hash
    $unowned = Start-TestInstaller $installer $recoveryRoot
    $children.Add($unowned)
    Wait-TestExit $unowned 2
    if ((Get-FileHash -LiteralPath $target).Hash -ne $legacyHash) { throw 'NSIS changed the unowned installation.' }
    if ((Get-FileHash -LiteralPath $backup).Hash -ne $userHash) { throw 'NSIS changed an unowned backup file.' }
    Write-Output 'PASS NSIS preserves files in an unmarked pre-existing backup directory.'
} finally {
    foreach ($child in $children) {
        if (-not $child.HasExited) { $child.Kill(); $child.WaitForExit() }
        $child.Dispose()
    }
}
