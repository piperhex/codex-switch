param([switch]$NoBuild, [switch]$MsiOnly, [string]$WixRoot, [string]$NsisCompiler)
$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
$tauri = Join-Path $repository 'apps/desktop/src-tauri'
$wix = if ($WixRoot) { $WixRoot } else { Join-Path $env:LOCALAPPDATA 'tauri/WixTools314' }
if (-not $NoBuild) {
    & node "$PSScriptRoot/build-installer-helper.mjs" --target x86_64-pc-windows-msvc
    if ($LASTEXITCODE) { throw 'MSI helper build failed.' }
    & node "$PSScriptRoot/check-installer-fixture.mjs" --target x86_64-pc-windows-msvc
    if ($LASTEXITCODE) { throw 'Installer fixture build failed.' }
}
$fixtureTarget = Join-Path $PSScriptRoot 'installer-fixture/target/x86_64-pc-windows-msvc/debug'
$fixtureBinary = Join-Path $fixtureTarget 'csw-installer-fixture.exe'
$helperTarget = Join-Path $tauri 'installer-helper/target/x86_64-pc-windows-msvc/release'
$helperBinary = Join-Path $helperTarget 'csw-installer-helper.exe'
foreach ($binary in @($fixtureBinary, $helperBinary)) {
    & node "$PSScriptRoot/verify-windows-runtime.mjs" $binary
    if ($LASTEXITCODE) { throw 'Installer runtime dependency check failed.' }
}
$runId = [guid]::NewGuid().ToString('N')
$testRoot = Join-Path $env:TEMP "csw-installer-test-$runId"
$installParent = Join-Path $repository '.codex-tmp/installer-native-tests'
$installRoot = Join-Path $installParent $runId
$otherRoot = Join-Path $testRoot 'other-installation'
New-Item -ItemType Directory -Path $testRoot,$installRoot,$otherRoot -Force | Out-Null
$productId = '{' + [guid]::NewGuid().ToString() + '}'
$upgradeProductId = '{' + [guid]::NewGuid().ToString() + '}'
$source = @'
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
  <Product Id="PRODUCT_ID" Name="Codex Switch Installer Test RUN_ID" Language="1033"
    Version="PRODUCT_VERSION" Manufacturer="Codex Switch Tests" UpgradeCode="UPGRADE_ID">
    <Package InstallerVersion="450" Compressed="yes" InstallScope="perUser" />
    <Property Id="REINSTALLMODE" Value="amus" />
    <Property Id="INSTALLDIR">
      <RegistrySearch Id="PreviousInstallDir" Root="HKCU" Key="Software\CodexSwitchInstallerTests\RUN_ID"
        Name="InstallDir" Type="raw" />
    </Property>
    <MajorUpgrade Schedule="afterInstallInitialize" AllowDowngrades="yes" />
    <Media Id="1" Cabinet="test.cab" EmbedCab="yes" />
    <Directory Id="TARGETDIR" Name="SourceDir">
      <Directory Id="LocalAppDataFolder">
        <Directory Id="TestRoot" Name="CodexSwitchInstallerTests">
          <Directory Id="INSTALLDIR" Name="RUN_ID">
            <Component Id="TestApplication" Guid="COMPONENT_ID">
              <File Id="TestExecutable" Source="FIXTURE_BINARY" Name="csw.exe" />
              <RegistryValue Root="HKCU" Key="Software\CodexSwitchInstallerTests\RUN_ID"
                Name="InstallDir" Type="string" Value="[INSTALLDIR]" KeyPath="yes" />
              <RemoveFolder Id="RemoveTestDirectory" On="uninstall" />
              <RemoveFolder Id="RemoveTestRoot" Directory="TestRoot" On="uninstall" />
            </Component>
          </Directory>
        </Directory>
      </Directory>
    </Directory>
    <Feature Id="TestApp" Title="Test" Level="1"><ComponentRef Id="TestApplication" /></Feature>
    LIFECYCLE_FEATURE
  </Product>
</Wix>
'@
$source = $source.Replace('RUN_ID', $runId)
$source = $source.Replace('UPGRADE_ID', [guid]::NewGuid().ToString())
$source = $source.Replace('COMPONENT_ID', [guid]::NewGuid().ToString())
$source = $source.Replace('FIXTURE_BINARY', [System.Security.SecurityElement]::Escape($fixtureBinary))
function Build-TestMsi([string]$Name, [string]$Product, [string]$Version, [switch]$Lifecycle) {
    $content = $source.Replace('PRODUCT_ID', $Product).Replace('PRODUCT_VERSION', $Version)
    $feature = if ($Lifecycle) { '<FeatureRef Id="CswInstallerLifecycle" />' } else { '' }
    $sourcePath = Join-Path $testRoot "$Name.wxs"
    [IO.File]::WriteAllText($sourcePath, $content.Replace('LIFECYCLE_FEATURE', $feature))
    $sources = @($sourcePath)
    $objects = @((Join-Path $testRoot "$Name.wixobj"))
    if ($Lifecycle) {
        $sources += "$tauri/windows/installer-lifecycle.wxs"
        $objects += "$testRoot/installer-lifecycle.wixobj"
    }
    & "$wix/candle.exe" -nologo -arch x64 -out "$testRoot\" @sources | Out-Host
    if ($LASTEXITCODE) { throw 'WiX fixture compilation failed.' }
    $msi = Join-Path $testRoot "$Name.msi"
    & "$wix/light.exe" -nologo -out $msi @objects | Out-Host
    if ($LASTEXITCODE) { throw 'WiX fixture validation/link failed.' }
    return $msi
}

# The installed baseline has no helper; the upgrade embeds the current release helper.
$legacyMsi = Build-TestMsi 'legacy' $productId '1.0.0'
$upgradeMsi = Build-TestMsi 'upgrade' $upgradeProductId '1.0.1' -Lifecycle

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
    Invoke-TestMsi '/i' $legacyMsi 'legacy-install.log'
    $installed = $true
    Copy-Item -LiteralPath $fixtureBinary -Destination (Join-Path $otherRoot 'csw.exe')
    $children += Start-Process (Join-Path $installRoot 'csw.exe') -WindowStyle Hidden -PassThru
    $children += Start-Process (Join-Path $otherRoot 'csw.exe') -WindowStyle Hidden -PassThru
    Write-Output "Testing running fixture: $(Join-Path $installRoot 'csw.exe')"
    if (-not (Test-Path -LiteralPath (Join-Path $installRoot 'csw.exe'))) { throw 'Fixture executable missing.' }
    Write-Output "Fixture process: $($children[0].Id)"
    Invoke-TestMsi '/i' $upgradeMsi 'upgrade.log'
    $productId = $upgradeProductId
    if (-not $children[0].HasExited) { throw 'MSI left its old application running.' }
    if ($children[1].HasExited) { throw 'MSI stopped a different installation.' }
    Write-Output 'PASS MSI embedded helper upgrades a helper-free legacy installation and preserves another installation.'

    $children += Start-Process (Join-Path $installRoot 'csw.exe') -WindowStyle Hidden -PassThru
    Start-Sleep -Milliseconds 300
    if ($children[2].HasExited) { throw 'The application could not start after the MSI upgrade.' }
    Invoke-TestMsi '/x' $productId 'uninstall.log'
    $installed = $false
    if (-not $children[2].HasExited) { throw 'MSI uninstall left its application running.' }
    if ($children[1].HasExited) { throw 'MSI uninstall stopped another installation.' }
    if (Test-Path -LiteralPath (Join-Path $installRoot 'csw.exe')) { throw 'MSI left its application file behind.' }
    Write-Output 'PASS MSI permits startup after install and closes the application on uninstall without a reboot.'
    if (-not $MsiOnly) {
        & "$PSScriptRoot/test-windows-nsis.ps1" -TestRoot $testRoot -InstallRoot $installRoot `
            -FixtureBinary $fixtureBinary -Compiler $NsisCompiler
        if ($children[1].HasExited) { throw 'NSIS stopped a different installation.' }
        Write-Output 'PASS NSIS preserves another installation.'
    }
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
