$ErrorActionPreference = 'Stop'
$moduleDirectory = Split-Path $PSScriptRoot -Parent
$goCommand = Get-Command go -ErrorAction SilentlyContinue
$goExecutable = if ($goCommand) { $goCommand.Source } else { 'C:/Program Files/Go/bin/go.exe' }
$previousGOOS = $env:GOOS
$previousGOARCH = $env:GOARCH
$previousCGO = $env:CGO_ENABLED
Push-Location $moduleDirectory
try {
    $env:GOOS = 'linux'
    $env:GOARCH = 'amd64'
    $env:CGO_ENABLED = '0'
    & $goExecutable build -trimpath -o testdata/bin/admin-go ./cmd/admin-go
    if ($LASTEXITCODE -ne 0) { throw 'Go build failed' }
} finally {
    $env:GOOS = $previousGOOS
    $env:GOARCH = $previousGOARCH
    $env:CGO_ENABLED = $previousCGO
    Pop-Location
}
