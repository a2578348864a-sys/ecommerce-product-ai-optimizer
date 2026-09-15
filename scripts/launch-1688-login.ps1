# Backward-compatible entrypoint for the production path in sourcingAcquisition.ts.
# The implementation lives in scripts/ops; keep this root path callable for older
# callers while the scripts directory is being reorganized.
$target = Join-Path -Path $PSScriptRoot -ChildPath 'ops\launch-1688-login.ps1'
if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
    Write-Error "1688 login launcher implementation is missing: $target"
    exit 1
}

& $target @args
if ($null -ne $LASTEXITCODE) {
    exit $LASTEXITCODE
}
exit 0
