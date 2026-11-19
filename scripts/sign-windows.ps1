# Authenticode-sign one file. Tauri passes the path as %1.
# WINDOWS_PFX is the .pfx path. WINDOWS_CERTIFICATE_PASSWORD is its password.
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Target
)

$ErrorActionPreference = "Stop"

if (-not $env:WINDOWS_PFX -or -not $env:WINDOWS_CERTIFICATE_PASSWORD) {
  Write-Error "WINDOWS_PFX and WINDOWS_CERTIFICATE_PASSWORD are required."
  exit 1
}

if (-not (Test-Path -LiteralPath $env:WINDOWS_PFX)) {
  Write-Error "Certificate file was not found."
  exit 1
}

if (-not (Test-Path -LiteralPath $Target)) {
  Write-Error "File to sign was not found: $Target"
  exit 1
}

$kitsRoot = ${env:ProgramFiles(x86)}
if (-not $kitsRoot) {
  Write-Error "ProgramFiles(x86) is not set."
  exit 1
}

$signtool = Get-ChildItem -Path (Join-Path $kitsRoot "Windows Kits\10\bin") -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '\\x64\\signtool.exe$' } |
  Sort-Object FullName -Descending |
  Select-Object -First 1

if (-not $signtool) {
  Write-Error "signtool.exe was not found. Install the Windows SDK."
  exit 1
}

Write-Host "signing $Target"
Write-Host "signtool $($signtool.FullName)"

& $signtool.FullName @(
  "sign",
  "/f", $env:WINDOWS_PFX,
  "/p", $env:WINDOWS_CERTIFICATE_PASSWORD,
  "/fd", "SHA256",
  "/tr", "http://timestamp.digicert.com",
  "/td", "SHA256",
  "/d", "Secretary",
  $Target
)

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Write-Host "signed $Target"
