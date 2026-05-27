param(
  [string]$TargetDir = "third_party/test262"
)

$ErrorActionPreference = "Stop"

if (Test-Path $TargetDir) {
  Write-Host "test262 already exists at $TargetDir"
  exit 0
}

$parent = Split-Path $TargetDir -Parent
if (!(Test-Path $parent)) {
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
}

git clone https://github.com/tc39/test262.git $TargetDir
Write-Host "Cloned test262 into $TargetDir"
