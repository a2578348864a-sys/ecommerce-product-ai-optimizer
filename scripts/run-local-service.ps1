$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$logRoot = Join-Path $env:LOCALAPPDATA "QingXuanAgent"
$stdoutPath = Join-Path $logRoot "local-3005.out.log"
$stderrPath = Join-Path $logRoot "local-3005.err.log"

New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
Set-Location -LiteralPath $repoRoot

$listener = Get-NetTCPConnection -LocalPort 3005 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    try {
        $health = Invoke-WebRequest -Uri "http://127.0.0.1:3005/api/health" -UseBasicParsing -TimeoutSec 5
        if ($health.StatusCode -eq 200) {
            [pscustomobject]@{ status = "local_3005_already_ready"; listenerPid = $listener.OwningProcess } | ConvertTo-Json -Compress
            exit 0
        }
    }
    catch {
        throw "local_3005_port_in_use_but_unhealthy"
    }
}

$npmPath = (Get-Command npm.cmd -ErrorAction Stop).Source
$process = Start-Process `
    -FilePath $npmPath `
    -ArgumentList @("run", "start:local") `
    -WorkingDirectory $repoRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -PassThru

for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:3005/api/health" -UseBasicParsing -TimeoutSec 3
        if ($response.StatusCode -eq 200) {
            $readyListener = Get-NetTCPConnection -LocalPort 3005 -State Listen | Select-Object -First 1
            [pscustomobject]@{ status = "local_3005_started"; launcherPid = $process.Id; listenerPid = $readyListener.OwningProcess } | ConvertTo-Json -Compress
            exit 0
        }
    }
    catch {
    }

    if ($process.HasExited) {
        throw "local_3005_launcher_exited_$($process.ExitCode)"
    }
    Start-Sleep -Seconds 1
}

throw "local_3005_start_timeout"
