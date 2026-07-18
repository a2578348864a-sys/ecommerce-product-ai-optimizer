param(
    [Parameter(Position = 0)]
    [ValidateSet("register", "status", "remove")]
    [string]$Mode = "register"
)

$ErrorActionPreference = "Stop"
$taskName = "QingXuanAgent-Local-3005"
$repoRoot = Split-Path -Parent $PSScriptRoot
$runScript = Join-Path $PSScriptRoot "run-local-service.ps1"
$userId = "$env:USERDOMAIN\$env:USERNAME"

if ($Mode -eq "remove") {
    $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($existing) {
        Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }
    [pscustomobject]@{ status = "removed"; taskName = $taskName } | ConvertTo-Json -Compress
    exit 0
}

if ($Mode -eq "status") {
    $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    $listener = Get-NetTCPConnection -LocalPort 3005 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    [pscustomobject]@{
        status = if ($existing) { "registered" } else { "missing" }
        taskName = $taskName
        taskState = if ($existing) { [string]$existing.State } else { $null }
        listenerPid = if ($listener) { $listener.OwningProcess } else { $null }
    } | ConvertTo-Json -Compress
    exit 0
}

$arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runScript`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments -WorkingDirectory $repoRoot
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$watchdogTrigger = New-ScheduledTaskTrigger -Once `
    -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 1) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger @($logonTrigger, $watchdogTrigger) `
    -Settings $settings `
    -Principal $principal `
    -Description "Ensure the guarded QingXuan Agent local service is available on 127.0.0.1:3005 after logon and every minute." `
    -Force | Out-Null

Start-ScheduledTask -TaskName $taskName

$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:3005/api/health" -UseBasicParsing -TimeoutSec 3
        if ($response.StatusCode -eq 200) {
            $ready = $true
            break
        }
    }
    catch {
    }
    Start-Sleep -Seconds 1
}

if (-not $ready) {
    throw "local_3005_autostart_registered_but_not_ready"
}

$task = Get-ScheduledTask -TaskName $taskName
$listener = Get-NetTCPConnection -LocalPort 3005 -State Listen | Select-Object -First 1
[pscustomobject]@{
    status = "registered_and_ready"
    taskName = $taskName
    taskState = [string]$task.State
    listenerPid = $listener.OwningProcess
} | ConvertTo-Json -Compress
