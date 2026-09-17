[CmdletBinding()]
param(
    [string]$NodePath = "",
    [string]$CliPath = "",
    [string]$LogPath = ""
)

# ASCII-only script (Windows PowerShell 5.1 reads UTF-8-no-BOM as ANSI).
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

if ([string]::IsNullOrEmpty($NodePath)) {
    $NodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
    if ([string]::IsNullOrEmpty($NodePath)) { $NodePath = "node" }
}
if ([string]::IsNullOrEmpty($CliPath)) {
    $homeDir = $env:USERPROFILE
    if ([string]::IsNullOrEmpty($homeDir)) { $homeDir = $env:HOME }
    $CliPath = Join-Path $homeDir ".1688\cli\dist\cli.js"
}
if ([string]::IsNullOrEmpty($LogPath)) {
    $homeDir = $env:USERPROFILE
    if ([string]::IsNullOrEmpty($homeDir)) { $homeDir = $env:HOME }
    $LogPath = Join-Path $homeDir ".1688\login-launch.log"
}

# 1. Clean up "exit_type":"Crashed" in Chrome preferences so the restore dialog
#    does not block a fresh headed window.
$homeDir = $env:USERPROFILE
if ([string]::IsNullOrEmpty($homeDir)) { $homeDir = $env:HOME }
$prefPath = Join-Path $homeDir ".1688\profiles\default\Default\Preferences"
if (Test-Path $prefPath) {
    try {
        $prefRaw = [System.IO.File]::ReadAllText($prefPath, [System.Text.Encoding]::UTF8)
        if ($prefRaw.Contains('"exit_type":"Crashed"')) {
            $prefClean = $prefRaw.Replace('"exit_type":"Crashed"', '"exit_type":"Normal"')
            [System.IO.File]::WriteAllText($prefPath, $prefClean, [System.Text.Encoding]::UTF8)
        }
    } catch {
        # ignore preference clean failure
    }
}

# 2. Launch the 1688 CLI via Start-Process (fire-and-detach).
#    P0 root cause fix: the old approach used `& $env:ComSpec /c $inner 2>&1 | Out-Null`
#    which kept the parent PowerShell alive waiting for the child's stdout pipe to EOF.
#    Start-Process creates a truly detached process — the launcher script exits
#    immediately after spawning, and the CLI runs independently in its own console.
#    Fixed arguments: login --headed --force --no-daemon (already proven to produce
#    visible non-headless Chrome; no client input is accepted).
$cliDir = Split-Path $CliPath -Parent
try {
    Start-Process -FilePath $NodePath `
        -ArgumentList "`"$CliPath`"","login","--headed","--force","--no-daemon" `
        -WorkingDirectory $cliDir `
        -WindowStyle Normal `
        -ErrorAction Stop
    @{
        ok  = $true
        pid = 0
    } | ConvertTo-Json -Compress
} catch {
    @{
        ok    = $false
        error = "Start-Process failed: " + $_.Exception.Message
    } | ConvertTo-Json -Compress
}
