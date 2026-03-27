param(
    [int]$Port = 8000,
    [string]$BindHost = "127.0.0.1"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $repoRoot

$pythonExe = "c:/AI_TUTOR/.venv/Scripts/python.exe"
if (-not (Test-Path $pythonExe)) {
    Write-Error "Python executable not found at $pythonExe"
}

# Stop any previously started uvicorn instance for this app to avoid stale-code routing.
$uvicornProcs = Get-CimInstance Win32_Process |
    Where-Object { $_.Name -eq "python.exe" -and $_.CommandLine -like "*uvicorn*fastapi_app:app*" }
if ($uvicornProcs) {
    foreach ($proc in $uvicornProcs) {
        $processId = [int]$proc.ProcessId
        if ($processId -and $processId -ne $PID) {
            try {
                Stop-Process -Id $processId -Force -ErrorAction Stop
                Write-Host "Stopped existing backend process $processId"
            } catch {
                Write-Warning "Could not stop backend process ${processId}: $($_.Exception.Message)"
            }
        }
    }
    Start-Sleep -Milliseconds 400
}

# Kill any process currently listening on the target port.
$listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listeners) {
    $pids = $listeners | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($processId in $pids) {
        if ($processId -and $processId -ne $PID) {
            try {
                Stop-Process -Id $processId -Force -ErrorAction Stop
                Write-Host "Stopped process $processId on port $Port"
            } catch {
                Write-Warning "Could not stop process ${processId}: $($_.Exception.Message)"
            }
        }
    }
}

Write-Host "Starting backend on http://${BindHost}:$Port ..."
& $pythonExe -m uvicorn fastapi_app:app --host $BindHost --port $Port
