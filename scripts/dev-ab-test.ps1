#Requires -Version 7.0
<#
.SYNOPSIS
    Dev Mode: AB Test - Run initialization + chat using normal game endpoints

.DESCRIPTION
    Initializes a game with preset data, sends a chat message, and collects
    full responses from both steps. Results are saved for later comparison.
    Uses the same normal game endpoints as the frontend.
    If SaveId is provided, skips initialization and only sends the chat message.
    Output is structured JSON to stdout, progress info to stderr.
    Detailed log is automatically saved to scripts/logs/ directory.

.PARAMETER Preset
    Preset name in format "template/preset" (e.g. "medieval-fantasy/warrior").
    Required when SaveId is not provided (for initialization).

.PARAMETER Message
    Chat message to send after initialization

.PARAMETER Label
    Test label for identification (e.g. "fix-20260524")

.PARAMETER SaveId
    Optional existing Save ID. If provided, skips initialization and only sends chat.
    Useful for re-testing chat behavior on an existing game session.

.PARAMETER Port
    Backend port number (default: 17334, or $env:BACKEND_PORT)

.PARAMETER TemplateId
    Optional template ID override

.PARAMETER Language
    Language code (default: zh-CN)

.EXAMPLE
    ./scripts/dev-ab-test.ps1 -Preset "medieval-fantasy/warrior" -Message "查看我的技能" -Label "fix-20260524"
    ./scripts/dev-ab-test.ps1 -SaveId "save-xxx" -Message "查看我的技能" -Label "chat-only-test"
#>

param(
    [Parameter(Mandatory=$false)]
    [string]$Preset = "",

    [Parameter(Mandatory=$true)]
    [string]$Message,

    [Parameter(Mandatory=$true)]
    [string]$Label,

    [Parameter(Mandatory=$false)]
    [string]$SaveId = "",

    [Parameter(Mandatory=$false)]
    [int]$Port = $($env:BACKEND_PORT ?? 17334),

    [Parameter(Mandatory=$false)]
    [string]$TemplateId = "",

    [Parameter(Mandatory=$false)]
    [string]$Language = "zh-CN"
)

# Validate: either Preset or SaveId must be provided
if (-not $Preset -and -not $SaveId) {
    Write-Error "ERROR: Either -Preset (for init+chat) or -SaveId (for chat-only) must be provided."
    exit 1
}

$BaseUrl = "http://localhost:$Port/api/v1"
$ErrorActionPreference = "Stop"

# --- Log setup ---
$LogDir = Join-Path $PSScriptRoot "logs"
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}
$LogTimestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LogFile = Join-Path $LogDir "ab-test-${LogTimestamp}.log"

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

Write-Log "===== dev-ab-test.ps1 START ====="
Write-Log "Parameters: Preset=$Preset, Message=$Message, Label=$Label, SaveId=$SaveId, Port=$Port, TemplateId=$TemplateId, Language=$Language"
Write-Log "LogFile: $LogFile"

# Progress timer
$timerScript = {
    $elapsed = 0
    while ($true) {
        Start-Sleep -Seconds 10
        $elapsed += 10
        Write-Host "[${elapsed}s] 等待处理完成..." -ForegroundColor Yellow 2>&1 | Write-Error
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

    $initResponse = $null
    $initMs = 0
    $overallStart = Get-Date

    # Step 1: Initialize (only if SaveId not provided)
    if (-not $SaveId) {
        $presetParts = $Preset -split '/'
        if ($presetParts.Length -ne 2) {
            Write-Log "Invalid preset format: $Preset (expected 'template/preset')" -Level ERROR
            Write-Error "ERROR: Preset must be in format 'template/preset' (e.g. 'medieval-fantasy/warrior')"
            exit 1
        }
        $templateName = $presetParts[0]
        $presetName = $presetParts[1]

        Write-Log "Loading preset: GET $BaseUrl/dev/presets/$templateName/$presetName"
        try {
            $presetResponse = Invoke-RestMethod -Uri "$BaseUrl/dev/presets/$templateName/$presetName" -Method Get -ErrorAction Stop
            Write-Log "Preset loaded"
        } catch {
            Write-Log "Failed to load preset '${Preset}': $($_.Exception.Message)" -Level ERROR
            Write-Error "ERROR: Preset '$Preset' not found."
            exit 1
        }

        $characterData = if ($presetResponse.success) { $presetResponse.data } else { $presetResponse }
        $resolvedTemplateId = if ($TemplateId) { $TemplateId } elseif ($characterData.templateId) { $characterData.templateId } else { $templateName }
        Write-Log "Resolved templateId: $resolvedTemplateId"

        Write-Log "=== Step 1: Initialize ==="
        $initBody = @{
            message = "开始新游戏"
            action  = "initialize"
            data    = @{
                templateId    = $resolvedTemplateId
                characterData = $characterData
                language      = $Language
            }
        }
        $initJsonBody = $initBody | ConvertTo-Json -Depth 5
        Write-Log "Init request body: $initJsonBody"

        Write-Log "Calling API: POST $BaseUrl/game (initialize)"
        $initStart = Get-Date
        $initResponse = Invoke-RestMethod -Uri "$BaseUrl/game" -Method Post -Body $initJsonBody -ContentType "application/json; charset=utf-8"
        $initMs = ((Get-Date) - $initStart).TotalMilliseconds
        Write-Log "Init response received (${initMs}ms)"

        # Extract saveId from init response
        $initData = $initResponse.data
        if ($initData.metadata) {
            $SaveId = $initData.metadata.saveId
            Write-Log "saveId: $SaveId"
        }
        if (-not $SaveId) {
            Write-Log "Failed to extract saveId from init response" -Level ERROR
            Write-Error "ERROR: Initialization succeeded but no saveId returned"
            exit 1
        }

        $initSuccess = $initData.success
        if (-not $initSuccess) {
            Write-Log "Initialization failed" -Level ERROR
            $result = @{
                label   = $Label
                preset  = $Preset
                init    = @{
                    success        = $false
                    response       = $initResponse
                    processingTime = $initMs
                }
                overallProcessingTime = $initMs
            }
            $result | ConvertTo-Json -Depth 20
            exit 1
        }
        Write-Log "Initialization succeeded"
    } else {
        Write-Log "=== Skipping init (using existing SaveId: $SaveId) ==="
    }

    # Step 2: Send chat message via normal endpoint
    Write-Log "=== Step 2: Chat ==="
    $chatBody = @{
        message = $Message
        saveId  = $SaveId
        action  = "chat"
    }
    $chatJsonBody = $chatBody | ConvertTo-Json -Depth 5
    Write-Log "Chat request body: $chatJsonBody"

    Write-Log "Calling API: POST $BaseUrl/game (chat)"
    $chatStart = Get-Date
    $chatResponse = Invoke-RestMethod -Uri "$BaseUrl/game" -Method Post -Body $chatJsonBody -ContentType "application/json; charset=utf-8"
    $chatMs = ((Get-Date) - $chatStart).TotalMilliseconds
    Write-Log "Chat response received (${chatMs}ms)"

    $overallMs = ((Get-Date) - $overallStart).TotalMilliseconds

    # Log chat response summary
    $chatData = $chatResponse.data
    if ($chatData.metadata) {
        Write-Log "Chat processing time: $($chatData.metadata.processingTime)ms"
    }
    # 统一面板变更推送机制：HTTP 响应不再包含 dialogue 字段（设计 5.13），由 panelUpdates.dialogue 推送

    # Build combined result
    $result = @{
        label  = $Label
        preset = $Preset
        saveId = $SaveId
        chat   = @{
            response       = $chatResponse
            processingTime = $chatMs
        }
        overallProcessingTime = $overallMs
    }
    if ($initResponse) {
        $result.init = @{
            success        = $true
            response       = $initResponse
            processingTime = $initMs
        }
    }

    # Write full response to a separate detailed log
    $detailLogFile = Join-Path $LogDir "ab-test-${LogTimestamp}-response.json"
    $resultJson = $result | ConvertTo-Json -Depth 20
    $resultJson | Out-File -FilePath $detailLogFile -Encoding UTF8
    Write-Log "Full result saved to: $detailLogFile"

    # Output JSON to stdout
    $result | ConvertTo-Json -Depth 20
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
    Write-Log "===== dev-ab-test.ps1 END ====="
    Write-Host "Log saved to: $LogFile" -ForegroundColor Cyan
}
