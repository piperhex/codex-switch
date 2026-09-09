param([switch]$NoBuild)
$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
$tauri = Join-Path $repository 'apps/desktop/src-tauri'
$helperRoot = Join-Path $tauri 'installer-helper'
$wix = Join-Path $env:LOCALAPPDATA 'tauri/WixTools314'
if (-not $NoBuild) {
    & cargo build --manifest-path "$helperRoot/Cargo.toml" --locked
    if ($LASTEXITCODE) { throw 'Helper debug build failed.' }
    & cargo build --manifest-path "$helperRoot/Cargo.toml" --locked --release --target x86_64-pc-windows-msvc
    if ($LASTEXITCODE) { throw 'Helper release build failed.' }
}
$fixtureBinary = Join-Path $helperRoot 'target/debug/csw-installer-helper.exe'
$runId = [guid]::NewGuid().ToString('N')
$testRoot = Join-Path $env:TEMP "csw-installer-test-$runId"
$installParent = Join-Path $repository '.codex-tmp/installer-native-tests'
$installRoot = Join-Path $installParent $runId
$otherRoot = Join-Path $testRoot 'other-installation'
New-Item -ItemType Directory -Path $testRoot,$installRoot,$otherRoot -Force | Out-Null
$productId = '{' + [guid]::NewGuid().ToString() + '}'
$source = @'
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
  <Product Id="PRODUCT_ID" Name="Codex Switch Installer Test RUN_ID" Language="1033"
    Version="1.0.0" Manufacturer="Codex Switch Tests" UpgradeCode="UPGRADE_ID">
    <Package InstallerVersion="450" Compressed="yes" InstallScope="perUser" />
    <Media Id="1" Cabinet="test.cab" EmbedCab="yes" />
    <Directory Id="TARGETDIR" Name="SourceDir">
      <Directory Id="LocalAppDataFolder">
        <Directory Id="TestRoot" Name="CodexSwitchInstallerTests">
          <Directory Id="INSTALLDIR" Name="RUN_ID">
            <Component Id="TestApplication" Guid="COMPONENT_ID">
              <File Id="TestExecutable" Source="FIXTURE_BINARY" Name="csw.exe" />
              <RegistryValue Root="HKCU" Key="Software\CodexSwitchInstallerTests\RUN_ID"
                Name="installed" Type="integer" Value="1" KeyPath="yes" />
              <RemoveFolder Id="RemoveTestDirectory" On="uninstall" />
              <RemoveFolder Id="RemoveTestRoot" Directory="TestRoot" On="uninstall" />
            </Component>
          </Directory>
        </Directory>
      </Directory>
    </Directory>
    <Feature Id="TestApp" Title="Test" Level="1"><ComponentRef Id="TestApplication" /></Feature>
    <FeatureRef Id="CswInstallerLifecycle" />
  </Product>
</Wix>
'@
$source = $source.Replace('PRODUCT_ID', $productId).Replace('RUN_ID', $runId)
$source = $source.Replace('UPGRADE_ID', [guid]::NewGuid().ToString())
$source = $source.Replace('COMPONENT_ID', [guid]::NewGuid().ToString())
$source = $source.Replace('FIXTURE_BINARY', [System.Security.SecurityElement]::Escape($fixtureBinary))
$sourcePath = Join-Path $testRoot 'fixture.wxs'
[IO.File]::WriteAllText($sourcePath, $source)
& "$wix/candle.exe" -nologo -arch x64 -out "$testRoot\" $sourcePath "$tauri/windows/installer-lifecycle.wxs"
if ($LASTEXITCODE) { throw 'WiX fixture compilation failed.' }
$msi = Join-Path $testRoot 'fixture.msi'
& "$wix/light.exe" -nologo -out $msi "$testRoot/fixture.wixobj" "$testRoot/installer-lifecycle.wixobj"
if ($LASTEXITCODE) { throw 'WiX fixture validation/link failed.' }

function Invoke-TestMsi([string]$Operation, [string]$Target, [string]$LogName) {
    $log = Join-Path $testRoot $LogName
    $process = Start-Process msiexec.exe -WindowStyle Hidden -PassThru -Wait -ArgumentList @(
        $Operation, ('"' + $Target + '"'), '/qn', '/norestart', '/l*v', ('"' + $log + '"')
        ('INSTALLDIR="' + $installRoot + '"')
    )
    if ($process.ExitCode -ne 0) { throw "MSI returned $($process.ExitCode). See $log" }
}

$children = @()
$installed = $false
try {
    foreach ($directory in @($installRoot,$otherRoot)) {
        Copy-Item -LiteralPath $fixtureBinary -Destination (Join-Path $directory 'csw.exe')
        $children += Start-Process (Join-Path $directory 'csw.exe') -ArgumentList 'fixture','stubborn' `
            -WindowStyle Hidden -PassThru
    }
    Write-Output "Testing running fixture: $(Join-Path $installRoot 'csw.exe')"
    if (-not (Test-Path -LiteralPath (Join-Path $installRoot 'csw.exe'))) { throw 'Fixture executable missing.' }
    Write-Output "Fixture process: $($children[0].Id)"
    Invoke-TestMsi '/i' $msi 'install.log'
    $installed = $true
    if (-not $children[0].HasExited) { throw 'MSI left its old application running.' }
    if ($children[1].HasExited) { throw 'MSI stopped a different installation.' }
    Write-Output 'PASS MSI replaces a running legacy application and preserves another installation.'

    $children += Start-Process (Join-Path $installRoot 'csw.exe') -ArgumentList 'fixture','cooperative' `
        -WindowStyle Hidden -PassThru
    Start-Sleep -Milliseconds 300
    if ($children[2].HasExited) { throw 'MSI left the startup gate active after success.' }
    Invoke-TestMsi '/x' $productId 'uninstall.log'
    $installed = $false
    if (-not $children[2].HasExited) { throw 'MSI uninstall left its application running.' }
    if ($children[1].HasExited) { throw 'MSI uninstall stopped another installation.' }
    Write-Output 'PASS MSI releases the startup gate after install and closes the application on uninstall.'
    & "$PSScriptRoot/test-windows-nsis.ps1" -TestRoot $testRoot -InstallRoot $installRoot `
        -FixtureBinary $fixtureBinary
    if ($children[1].HasExited) { throw 'NSIS stopped a different installation.' }
    Write-Output 'PASS NSIS preserves another installation.'
    Write-Output "Installer logs: $testRoot"
} finally {
    foreach ($child in $children) {
        if (-not $child.HasExited) { $child.Kill(); $child.WaitForExit() }
        $child.Dispose()
    }
    if ($installed) { Invoke-TestMsi '/x' $productId 'cleanup.log' }
    # Only this run's unique installation directory is removable; keep logs for inspection.
    $resolvedInstall = [IO.Path]::GetFullPath($installRoot)
    $expectedParent = [IO.Path]::GetFullPath($installParent)
    if ((Split-Path -Parent $resolvedInstall) -ne $expectedParent) { throw 'Unsafe test cleanup path.' }
    if (Test-Path -LiteralPath $resolvedInstall) { Remove-Item -LiteralPath $resolvedInstall -Recurse -Force }
}
