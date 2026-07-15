param(
    [Parameter(Mandatory = $true)]
    [string]$SubmissionFile,

    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory,

    [string]$InventoryFile = "",
    [string]$Stage2PacketFile = "",
    [string]$RankingFile = "",
    [string]$DecidedAt = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$appRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $appRoot ".."))
$validationDirectories = @(Get-ChildItem -LiteralPath $projectRoot -Directory | Where-Object { $_.Name -like "06_*" })
if ($validationDirectories.Count -ne 1) {
    throw "VALIDATION_ROOT_NOT_UNIQUE"
}
$validationRoot = [System.IO.Path]::GetFullPath($validationDirectories[0].FullName)
$stage2Root = Join-Path $validationRoot "2026-07-14-Phase-Stage1-Solo-Validation-01"
$gapDirectories = @(Get-ChildItem -LiteralPath $stage2Root -Directory | Where-Object { $_.Name -like "05-*" })
$packetDirectories = @(Get-ChildItem -LiteralPath $stage2Root -Directory | Where-Object { $_.Name -like "02-*" })
if ($gapDirectories.Count -ne 1 -or $packetDirectories.Count -ne 1) {
    throw "STAGE2_SOURCE_DIRECTORIES_NOT_UNIQUE"
}

if ([string]::IsNullOrWhiteSpace($InventoryFile)) {
    $InventoryFile = Join-Path $gapDirectories[0].FullName "stage2-evidence-gap-inventory.v1.json"
}
if ([string]::IsNullOrWhiteSpace($Stage2PacketFile)) {
    $Stage2PacketFile = Join-Path $packetDirectories[0].FullName "stage2-objective-calibration-packet.v1.json"
}
if ([string]::IsNullOrWhiteSpace($RankingFile)) {
    $RankingFile = Join-Path $validationRoot "2026-07-14-Phase-Amazon-Human-Assisted-Canary-15\stage1-ranking.v1.json"
}
if ([string]::IsNullOrWhiteSpace($DecidedAt)) {
    $DecidedAt = [DateTime]::UtcNow.ToString("o")
}

function Resolve-SafeValidationFile {
    param([string]$Path, [string]$Label)
    if ($Path -match '(^|[\\/])\.env($|\.)') {
        throw "${Label}_ENV_FILE_FORBIDDEN"
    }
    $resolved = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path
    $full = [System.IO.Path]::GetFullPath($resolved)
    if (-not $full.StartsWith($validationRoot + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "${Label}_OUTSIDE_VALIDATION_ROOT"
    }
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
        throw "${Label}_NOT_FILE"
    }
    return $full
}

$safeSubmission = Resolve-SafeValidationFile -Path $SubmissionFile -Label "SUBMISSION"
$safeInventory = Resolve-SafeValidationFile -Path $InventoryFile -Label "INVENTORY"
$safePacket = Resolve-SafeValidationFile -Path $Stage2PacketFile -Label "STAGE2_PACKET"
$safeRanking = Resolve-SafeValidationFile -Path $RankingFile -Label "RANKING"
$safeOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
if (-not $safeOutput.StartsWith($validationRoot + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "OUTPUT_OUTSIDE_VALIDATION_ROOT"
}
$parsedDecidedAt = [DateTime]::MinValue
if (-not [DateTime]::TryParse($DecidedAt, [ref]$parsedDecidedAt)) {
    throw "DECIDED_AT_INVALID"
}

$vitest = Join-Path $appRoot "node_modules\.bin\vitest.cmd"
if (-not (Test-Path -LiteralPath $vitest -PathType Leaf)) {
    throw "LOCAL_VITEST_NOT_FOUND"
}

$previousLocation = Get-Location
try {
    $env:STAGE2_ADVANCEMENT_INVENTORY_FILE = $safeInventory
    $env:STAGE2_ADVANCEMENT_SUBMISSION_FILE = $safeSubmission
    $env:STAGE2_ADVANCEMENT_PACKET_FILE = $safePacket
    $env:STAGE2_ADVANCEMENT_RANKING_FILE = $safeRanking
    $env:STAGE2_ADVANCEMENT_OUTPUT_DIRECTORY = $safeOutput
    $env:STAGE2_ADVANCEMENT_DECIDED_AT = ([DateTime]$parsedDecidedAt).ToUniversalTime().ToString("o")
    Set-Location -LiteralPath $appRoot
    & $vitest run tools/upstream/generate-stage2-advancement-materials.runtime.test.ts
    if ($LASTEXITCODE -ne 0) {
        throw "STAGE2_OFFLINE_VALIDATION_FAILED_EXIT_$LASTEXITCODE"
    }
}
finally {
    Set-Location -LiteralPath $previousLocation
    Remove-Item Env:STAGE2_ADVANCEMENT_INVENTORY_FILE -ErrorAction SilentlyContinue
    Remove-Item Env:STAGE2_ADVANCEMENT_SUBMISSION_FILE -ErrorAction SilentlyContinue
    Remove-Item Env:STAGE2_ADVANCEMENT_PACKET_FILE -ErrorAction SilentlyContinue
    Remove-Item Env:STAGE2_ADVANCEMENT_RANKING_FILE -ErrorAction SilentlyContinue
    Remove-Item Env:STAGE2_ADVANCEMENT_OUTPUT_DIRECTORY -ErrorAction SilentlyContinue
    Remove-Item Env:STAGE2_ADVANCEMENT_DECIDED_AT -ErrorAction SilentlyContinue
}

Write-Output "STAGE2_OFFLINE_VALIDATION_COMPLETE"
Write-Output "OUTPUT_DIRECTORY=$safeOutput"
