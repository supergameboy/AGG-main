#Requires -Version 7.0
<#
.SYNOPSIS
    Dev Mode: Chat - Send chat message via normal game endpoint

.DESCRIPTION
    Sends a chat message through the normal game endpoint, matching the
    frontend's request format. Output is structured JSON to stdout,
    progress info to stderr.
    Detailed log is automatically saved to scripts/logs/ directory.

.PARAMETER SaveId
    Save ID to send the message to

.PARAMETER Message
    Chat message text

.PARAMETER Action
    Optional action type (e.g. "combat", "chat")

.PARAMETER NpcId
    Optional NPC ID for NPC-targeted actions

.PARAMETER Port
    Backend port number (default: 17334, or $env:BACKEND_PORT)

.EXAMPLE
    ./scripts/dev-chat.ps1 -SaveId "save-xxx" -Message "查看我的技能"
    ./scripts/dev-chat.ps1 -SaveId "save-xxx" -Message "攻击哥布林" -Action "combat" -NpcId "npc-xxx"
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$SaveId,

    [Parameter(Mandatory=$true)]
    [string]$Message,

    [Parameter(Mandatory=$false)]
    [string]$Action = "",

    [Parameter(Mandatory=$false)]
    [string]$NpcId = "",

    [Parameter(Mandatory=$false)]
    [string[]]$TargetNpcIds = @(),

    [Parameter(Mandatory=$false)]
    [string]$PlayerActionType = "",

    [Parameter(Mandatory=$false)]
    [string]$PlayerActionItemId = "",

    [Parameter(Mandatory=$false)]
    [string]$PlayerActionTargetNpcId = "",

    [Parameter(Mandatory=$false)]
    [string]$PlayerActionSelectedOptionId = "",

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
$LogFile = Join-Path $LogDir "chat-${LogTimestamp}.log"

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

Write-Log "===== dev-chat.ps1 START ====="
Write-Log "Parameters: SaveId=$SaveId, Message=$Message, Action=$Action, NpcId=$NpcId, Port=$Port"
Write-Log "LogFile: $LogFile"

# Progress timer
$timerScript = {
    $elapsed = 0
    while ($true) {
        Start-Sleep -Seconds 10
        $elapsed += 10
        Write-Host "[${elapsed}s] 等待Agent处理完成..." -ForegroundColor Yellow 2>&1 | Write-Error
    }
}

$timer = Start-Job -ScriptBlock $timerScript

try {
    # Health check
    Write-Log "Health check: GET $BaseUrl/health"
    $healthStart = Get-Date
    try {
        $health = Invoke-RestMethod -Uri "$BaseUrl/health" -Method Get -TimeoutSec 5 -ErrorAction Stop
        $healthMs = ((Get-Date) - $healthStart).TotalMilliseconds
        Write-Log "Health check passed (${healthMs}ms)"
    } catch {
        $healthMs = ((Get-Date) - $healthStart).TotalMilliseconds
        Write-Log "Health check FAILED after ${healthMs}ms: $($_.Exception.Message)" -Level ERROR
        Write-Error "ERROR: Backend not reachable at $BaseUrl. Is the server running?"
        exit 1
    }

    # Build request body matching frontend format
    $body = @{
        message = $Message
        saveId  = $SaveId
    }
    if ($Action) { $body.action = $Action }
    if ($NpcId) { $body.npcId = $NpcId }
    if ($TargetNpcIds.Count -gt 0) { $body.targetNpcIds = $TargetNpcIds }

    # Build playerAction if any PlayerAction parameter is provided
    if ($PlayerActionType) {
        $playerAction = @{ type = $PlayerActionType }
        if ($PlayerActionItemId) { $playerAction.itemId = $PlayerActionItemId }
        if ($PlayerActionTargetNpcId) { $playerAction.targetNpcId = $PlayerActionTargetNpcId }
        if ($PlayerActionSelectedOptionId) { $playerAction.selectedOptionId = $PlayerActionSelectedOptionId }
        $body.playerAction = $playerAction
        Write-Log "PlayerAction: type=$PlayerActionType, itemId=$PlayerActionItemId, targetNpcId=$PlayerActionTargetNpcId, selectedOptionId=$PlayerActionSelectedOptionId"
    }

    $jsonBody = $body | ConvertTo-Json -Depth 5
    Write-Log "Request body: $jsonBody"

    # Call normal game endpoint
    Write-Log "Calling API: POST $BaseUrl/game"
    $apiStart = Get-Date
    $response = Invoke-RestMethod -Uri "$BaseUrl/game" -Method Post -Body $jsonBody -ContentType "application/json; charset=utf-8"
    $apiMs = ((Get-Date) - $apiStart).TotalMilliseconds
    Write-Log "API response received (${apiMs}ms)"

    # Log response summary
    $responseJson = $response | ConvertTo-Json -Depth 20
    $responseSize = [System.Text.Encoding]::UTF8.GetByteCount($responseJson)
    Write-Log "Response size: $responseSize bytes"

    # Extract key fields from normal game response
    $responseData = $response.data
    if ($responseData.metadata) {
        $processingTime = $responseData.metadata.processingTime
        Write-Log "Processing time: ${processingTime}ms"
    }
    # 统一面板变更推送机制：HTTP 响应不再包含 dialogue 字段（设计 5.13），由 panelUpdates.dialogue 推送

    # Write full response to a separate detailed log
    $detailLogFile = Join-Path $LogDir "chat-${LogTimestamp}-response.json"
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
    Stop-Job $timer -ErrorAction SilentlyContinue
    Remove-Job $timer -ErrorAction SilentlyContinue
    Write-Log "===== dev-chat.ps1 END ====="
    Write-Host "Log saved to: $LogFile" -ForegroundColor Cyan
}
