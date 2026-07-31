#Requires -Version 7.0
<#
.SYNOPSIS
    Dev Mode: Compare - Compare two AB test results

.DESCRIPTION
    Compares two AB test snapshots using the existing snapshot comparison API.
    Output is structured JSON to stdout.
    Detailed log is automatically saved to scripts/logs/ directory.

.PARAMETER TestId1
    First test ID (from dev-ab-test output)

.PARAMETER TestId2
    Second test ID (from dev-ab-test output)

.PARAMETER Port
    Backend port number (default: 17334, or $env:BACKEND_PORT)

.EXAMPLE
    ./scripts/dev-compare.ps1 -TestId1 "ab-001" -TestId2 "ab-002"
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$TestId1,

    [Parameter(Mandatory=$true)]
    [string]$TestId2,

    [Parameter(Mandatory=$false)]
    [int]$Port = $($env:BACKEND_PORT ?? 17334)
)

$BaseUrl = "http://localhost:$Port/api/v1"
$ErrorActionPreference = "Stop"

# --- Log setup ---
$LogDir = Join-Path $PSScriptRoot "logs"
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}
$LogTimestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LogFile = Join-Path $LogDir "compare-${LogTimestamp}.log"

function Write-Log {
    param(
        [Parameter(Mandatory=$true)]
        [string]$Message,
        [ValidateSet("INFO","WARN","ERROR","DEBUG")]
        [string]$Level = "INFO"
    )
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff"
    $line = "[$ts] [$Level] $Message"
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
    switch ($Level) {
        "ERROR" { Write-Host $line -ForegroundColor Red }
        "WARN"  { Write-Host $line -ForegroundColor Yellow }
        "DEBUG" { Write-Host $line -ForegroundColor DarkGray }
        default { Write-Host $line -ForegroundColor White }
    }
}

Write-Log "===== dev-compare.ps1 START ====="
Write-Log "Parameters: TestId1=$TestId1, TestId2=$TestId2, Port=$Port"
Write-Log "LogFile: $LogFile"

try {
    # Health check
    Write-Log "Health check: GET $BaseUrl/health"
    $healthStart = Get-Date
    try {
        $health = Invoke-RestMethod -Uri "$BaseUrl/health" -Method Get -TimeoutSec 5 -ErrorAction Stop
        $healthMs = ((Get-Date) - $healthStart).TotalMilliseconds
        Write-Log "Health check passed (${healthMs}ms)"
        Write-Log "Health response: $($health | ConvertTo-Json -Depth 5 -Compress)"
    } catch {
        $healthMs = ((Get-Date) - $healthStart).TotalMilliseconds
        Write-Log "Health check FAILED after ${healthMs}ms: $($_.Exception.Message)" -Level ERROR
        Write-Error "ERROR: Backend not reachable at $BaseUrl. Is the server running?"
        exit 1
    }

    # Build request body
    $body = @{
        snapshotId1 = $TestId1
        snapshotId2 = $TestId2
    }

    $jsonBody = $body | ConvertTo-Json -Depth 5
    Write-Log "Request body: $jsonBody"

    # Call snapshot compare API
    Write-Log "Calling API: POST $BaseUrl/dev/snapshots/compare"
    $apiStart = Get-Date
    $response = Invoke-RestMethod -Uri "$BaseUrl/dev/snapshots/compare" -Method Post -Body $jsonBody -ContentType "application/json; charset=utf-8"
    $apiMs = ((Get-Date) - $apiStart).TotalMilliseconds
    Write-Log "API response received (${apiMs}ms)"

    # Log response summary
    $responseJson = $response | ConvertTo-Json -Depth 20
    $responseSize = [System.Text.Encoding]::UTF8.GetByteCount($responseJson)
    Write-Log "Response size: $responseSize bytes"

    # Log comparison details if present
    if ($response.differences) {
        Write-Log "Differences found: $($response.differences.Count)"
        foreach ($diff in $response.differences) {
            Write-Log "  Diff: $($diff.field) - $($diff.type)" -Level DEBUG
        }
    }
    if ($response.summary) {
        Write-Log "Comparison summary: $($response.summary | ConvertTo-Json -Depth 3 -Compress)"
    }

    # Write full response to a separate detailed log
    $detailLogFile = Join-Path $LogDir "compare-${LogTimestamp}-response.json"
    $responseJson | Out-File -FilePath $detailLogFile -Encoding UTF8
    Write-Log "Full response saved to: $detailLogFile"

    # Output JSON to stdout
    $response | ConvertTo-Json -Depth 20
}
catch {
    $errorMsg = $_.Exception.Message
    Write-Log "EXCEPTION: $errorMsg" -Level ERROR
    if ($_.Exception.Response) {
        try {
            $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
            $errorBody = $reader.ReadToEnd()
            $reader.Close()
            Write-Log "Error response body: $errorBody" -Level ERROR
            Write-Error $errorBody
        } catch {
            Write-Log "Could not read error response body: $($_.Exception.Message)" -Level ERROR
            Write-Error "ERROR: $errorMsg"
        }
    } else {
        Write-Error "ERROR: $errorMsg"
    }
    exit 1
}
finally {
    Write-Log "===== dev-compare.ps1 END ====="
    Write-Host "Log saved to: $LogFile" -ForegroundColor Cyan
}
