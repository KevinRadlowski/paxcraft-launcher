# PACK-10.1SYNC-12D — AFTER-INSTALL verification (read-only).
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\e2e\verify-fresh-firstrun.ps1 -InstanceRoot "E:\Jeux\SweetCraft-E2E-FRESH"
#
# Refuses the validated legacy path E:\Jeux\SweetCraft.
# Does not mutate the instance.

param(
  [Parameter(Mandatory = $true)]
  [string] $InstanceRoot,
  [string] $ExpectedReleaseSha256 = "a36d53e4d9a49ec9435fae641459202cf6ce9f633dfb39bf03e9a7e761d11d61",
  [string] $ExpectedCasinoFile = "xbase-casino-0.9.17-B2.7.2.1+mc26.1.2.jar",
  [string] $ExpectedCasinoSha256 = "750128c35b68443e5cf3e760cc29781a79229c60473681dedb91b40acf7e269c"
)

$ErrorActionPreference = "Stop"

# Resolve RepoRoot inside the executable body — never rely on param defaults / empty $PSScriptRoot.
$scriptDir = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($scriptDir)) {
  if ($MyInvocation.MyCommand.Path) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
  } elseif ($PSCommandPath) {
    $scriptDir = Split-Path -Parent $PSCommandPath
  } else {
    throw "VERIFIER_TOOL_FAILURE: cannot resolve script directory (PSScriptRoot/MyInvocation empty)"
  }
}
$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir "..\.."))
$serversCheckJs = Join-Path $scriptDir "parse-servers-check.mjs"
if (-not (Test-Path -LiteralPath $serversCheckJs)) {
  throw "VERIFIER_TOOL_FAILURE: missing helper $serversCheckJs"
}
if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot "dist\instance\firstRun\serversDat.js"))) {
  throw "VERIFIER_TOOL_FAILURE: missing built module under $RepoRoot\dist (run pnpm build)"
}

$legacy = "E:\Jeux\SweetCraft"
$root = [System.IO.Path]::GetFullPath($InstanceRoot)
if ($root.TrimEnd('\') -ieq $legacy.TrimEnd('\')) {
  throw "REFUSE: do not verify/mutate the legacy reference instance $legacy"
}

function Fail([string]$msg) { throw "FAIL: $msg" }
function Ok([string]$msg) { Write-Host "OK  $msg" }

$statePath = Join-Path $root "launcher\state.json"
$optionsPath = Join-Path $root "options.txt"
$serversPath = Join-Path $root "servers.dat"
$modsDir = Join-Path $root "mods"

if (-not (Test-Path -LiteralPath $statePath)) { Fail "missing $statePath" }
$state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json

if ($state.installedPackVersion -ne "0.1.4") { Fail "packVersion=$($state.installedPackVersion) expected 0.1.4" }
Ok "packVersion=0.1.4"

if ([int]$state.installedReleaseSequence -ne 5) { Fail "seq=$($state.installedReleaseSequence) expected 5" }
Ok "releaseSequence=5"

$rel = ([string]$state.installedReleaseSha256).ToLowerInvariant()
if ($rel -ne $ExpectedReleaseSha256.ToLowerInvariant()) {
  Fail "installedReleaseSha256=$rel expected $ExpectedReleaseSha256"
}
Ok "installedReleaseSha256=$rel"

$seeds = @($state.appliedFirstRunSeeds)
if ($seeds -notcontains "mc-options-firstrun") { Fail "missing seed mc-options-firstrun: $($seeds -join ',')" }
if ($seeds -notcontains "mc-servers-sweetcraft") { Fail "missing seed mc-servers-sweetcraft: $($seeds -join ',')" }
Ok "appliedFirstRunSeeds=$($seeds -join ',')"

if (-not (Test-Path -LiteralPath $optionsPath)) { Fail "missing options.txt" }
$options = Get-Content -LiteralPath $optionsPath -Raw -Encoding UTF8
if ($options -notmatch '(?m)^lang:fr_fr\s*$') { Fail "lang is not fr_fr" }
Ok "lang:fr_fr"

if ($options -notmatch 'resourcePacks:') { Fail "resourcePacks missing" }
$rpLine = ($options -split "`n" | Where-Object { $_ -match '^resourcePacks:' } | Select-Object -First 1)
if (-not $rpLine) { Fail "resourcePacks line missing" }
$rpJson = $rpLine -replace '^resourcePacks:', ''
$packs = $rpJson | ConvertFrom-Json
$packsArr = @($packs)
$frHits = @($packsArr | Where-Object { $_ -like 'file/SweetCraft-FR*' })
if ($frHits.Count -lt 1) { Fail "SweetCraft-FR not enabled in resourcePacks: $($packsArr -join ',')" }
Ok "SweetCraft-FR enabled: $($frHits[0])"

$faithfulHits = @($packsArr | Where-Object { $_ -like '*Faithful*' })
if ($faithfulHits.Count -gt 0) { Fail "Faithful must not be auto-enabled: $($faithfulHits -join ',')" }
Ok "Faithful not auto-enabled"

if (-not (Test-Path -LiteralPath $serversPath)) {
  Fail "SERVERS_DAT_MISSING: $serversPath"
}

# Absolute path args — helper resolves dist via import.meta.url (not cwd / %TEMP%).
$serversAbs = [System.IO.Path]::GetFullPath($serversPath)
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$out = & node $serversCheckJs $serversAbs 2>&1
$exit = $LASTEXITCODE
$ErrorActionPreference = $prevEap
$outText = ($out | Out-String).Trim()

if ($exit -eq 4) {
  throw "VERIFIER_TOOL_FAILURE: servers.dat helper failed`n$outText"
}
if ($exit -eq 3) {
  Fail "SERVERS_DAT_INVALID: $outText"
}
if ($exit -eq 2) {
  Fail "SWEETCRAFT_SERVER_ABSENT: $outText"
}
if ($exit -ne 0) {
  throw "VERIFIER_TOOL_FAILURE: unexpected helper exit=$exit`n$outText"
}
Ok "servers.dat SweetCraft @ sweetcraft.datho.st ($outText)"

$jars = @(Get-ChildItem -LiteralPath $modsDir -Filter "*.jar" -File -ErrorAction Stop)
if ($jars.Count -ne 110) { Fail "mods jar count=$($jars.Count) expected 110" }
Ok "mods jars=110"

$casino = Join-Path $modsDir $ExpectedCasinoFile
if (-not (Test-Path -LiteralPath $casino)) { Fail "missing casino jar $ExpectedCasinoFile" }
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $casino).Hash.ToLowerInvariant()
if ($hash -ne $ExpectedCasinoSha256.ToLowerInvariant()) {
  Fail "casino sha=$hash expected $ExpectedCasinoSha256"
}
Ok "casino $ExpectedCasinoFile sha256 ok"

Write-Host ""
Write-Host "VERIFY_FRESH_FIRSTRUN_PASS root=$root"
Write-Host "repoRoot=$RepoRoot"
Write-Host "Stop here before Play if you only needed disk/state certification."
