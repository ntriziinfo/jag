$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoFromParent = Join-Path $here "whitedevil-current"
if (Test-Path -LiteralPath (Join-Path $repoFromParent ".git")) {
  $repo = $repoFromParent
} elseif (Test-Path -LiteralPath (Join-Path $here ".git")) {
  $repo = $here
} else {
  throw "Git repository was not found."
}

$dropboxBase = -join ([char[]](0x30B9, 0x30C8, 0x30B0, 0x30E9))
$dropboxProject = -join ([char[]](0x30B9, 0x30ED, 0x30C3, 0x30C8, 0x958B, 0x767A))
$materialsDir = -join ([char[]](0x7D20, 0x6750))
$dropbox = Join-Path (Join-Path (Join-Path $env:USERPROFILE "Dropbox") $dropboxBase) $dropboxProject

if (-not (Test-Path -LiteralPath $dropbox)) {
  throw "Dropbox folder was not found: $dropbox"
}

$rootFiles = @(
  ".gitignore",
  "AGENTS.md",
  "README.txt",
  "admin.html",
  "gorai.html",
  "gorai_complete_test.html",
  "index.html",
  "server.js"
)

foreach ($file in $rootFiles) {
  $source = Join-Path $repo $file
  if (Test-Path -LiteralPath $source) {
    Copy-Item -LiteralPath $source -Destination (Join-Path $dropbox $file) -Force
  }
}

$dirs = @("assets", "Documents", "Wesker", $materialsDir)
foreach ($dir in $dirs) {
  $source = Join-Path $repo $dir
  if (Test-Path -LiteralPath $source) {
    $dest = Join-Path $dropbox $dir
    robocopy $source $dest /E /XF *.zip /R:0 /W:0 /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) {
      throw "Failed to sync folder: $dir"
    }
  }
}

$launcher = @'
@echo off
call "C:\Users\RIZI1\Documents\Codex\2026-05-15\new-chat\push-to-github.cmd" %*
'@
Set-Content -LiteralPath (Join-Path $dropbox "push-to-github.cmd") -Value $launcher -Encoding ASCII

Write-Host "Dropbox sync completed."
