param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 8788,
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$previewRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
Push-Location -LiteralPath $previewRoot
try {
  if (-not $SkipBuild) {
    & pnpm.cmd build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed; the preview was not started.' }
  }
  if (-not (Test-Path -LiteralPath (Join-Path $previewRoot 'dist/hook-havok/index.html'))) {
    throw 'The built game is missing. Run again without -SkipBuild.'
  }
  Write-Host 'Keep this terminal open while testing. Ctrl+C stops the local preview.'
  Write-Host 'Open /hook-havok/?mute on the free port printed below.'
  & node --import tsx service/dev.ts --port $Port
  if ($LASTEXITCODE -ne 0) { throw "Preview exited with code $LASTEXITCODE." }
} finally {
  Pop-Location
}
