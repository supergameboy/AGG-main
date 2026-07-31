#Requires -Version 7.0
<#
.SYNOPSIS
    Dev Mode: Quick Init - One-click game initialization with preset character data

.DESCRIPTION
    Initializes a game with preset character data using the normal game endpoint.
    Loads preset via dev/presets API, then sends a real initialize request
    matching the frontend's request format.
    Output is structured JSON to stdout, progress info to stderr.
    Detailed log is automatically saved to scripts/logs/ directory.

.PARAMETER Preset
    Preset name in format "template/preset" (e.g. "medieval-fantasy/warrior")

.PARAMETER Port
    Backend port number (default: 17334, or $env:BACKEND_PORT)

.PARAMETER TemplateId
    Optional template ID override (auto-detected from preset name if not specified)

.PARAMETER Language
    Language code (default: zh-CN)

.EXAMPLE
    ./scripts/dev-quick-init.ps1 -Preset "medieval-fantasy/warrior"
    ./scripts/dev-quick-init.ps1 -Preset "cyberpunk-mercenary/hacker" -Port 8080
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$Preset,

    [Parameter(Mandatory=$false)]
    [int]$Port = $($env:BACKEND_PORT ?? 17334),

    [Parameter(Mandatory=$false)]
    [string]$TemplateId = "",

    [Parameter(Mandatory=$false)]
    [string]$Language = "zh-CN"
)

$BaseUrl = "http://localhost:$Port/api/v1"
$ErrorActionPreference = "Stop"

# --- Log setup ---
$LogDir = Join-Path $PSScriptRoot "logs"
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}
$LogTimestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LogFile = Join-Path $LogDir "quick-init-${LogTimestamp}.log"

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

Write-Log "===== dev-quick-init.ps1 START ====="
Write-Log "Parameters: Preset=$Preset, Port=$Port, TemplateId=$TemplateId, Language=$Language"
Write-Log "LogFile: $LogFile"

# Progress timer
$timerScript = {
    $elapsed = 0
    while ($true) {
        Start-Sleep -Seconds 10
        $elapsed += 10
        Write-Host "[${elapsed}s] 等待初始化完成..." -ForegroundColor Yellow 2>&1 | Write-Error
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

    # Step 1: Load preset data via dev/presets API
    $presetParts = $Preset -split '/'
    if ($presetParts.Length -ne 2) {
        Write-Log "Invalid preset format: $Preset (expected 'template/preset')" -Level ERROR
        Write-Error "ERROR: Preset must be in format 'template/preset' (e.g. 'medieval-fantasy/warrior')"
        exit 1
    }
    $templateName = $presetParts[0]
    $presetName = $presetParts[1]

    Write-Log "Loading preset: GET $BaseUrl/dev/presets/$templateName/$presetName"
    $presetStart = Get-Date
    try {
        $presetData = Invoke-RestMethod -Uri "$BaseUrl/dev/presets/$templateName/$presetName" -Method Get -ErrorAction Stop
        $presetMs = ((Get-Date) - $presetStart).TotalMilliseconds
        Write-Log "Preset loaded (${presetMs}ms)"
    } catch {
        $presetMs = ((Get-Date) - $presetStart).TotalMilliseconds
        Write-Log "Failed to load preset '${Preset}': $($_.Exception.Message)" -Level ERROR
        Write-Error "ERROR: Preset '$Preset' not found. Use GET /api/v1/dev/presets to list available presets."
        exit 1
    }

    # Unwrap preset data from successResponse envelope
    $characterData = if ($presetData.success) { $presetData.data } else { $presetData }
    Write-Log "Character data: name=$($characterData.name), race=$($characterData.race), class=$($characterData.classType)"

    # Resolve templateId: parameter > preset field > template name from preset path
    $resolvedTemplateId = if ($TemplateId) { $TemplateId } elseif ($characterData.templateId) { $characterData.templateId } else { $templateName }
    Write-Log "Resolved templateId: $resolvedTemplateId"

    # Step 2: Build request body matching frontend format
    $body = @{
        message = "开始新游戏"
        action  = "initialize"
        data    = @{
            templateId    = $resolvedTemplateId
            characterData = $characterData
            language      = $Language
        }
    }

    $jsonBody = $body | ConvertTo-Json -Depth 5
    Write-Log "Request body: $jsonBody"

    # Step 3: Call normal game endpoint
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
        $saveId = $responseData.metadata.saveId
        $characterId = $responseData.metadata.characterId
        Write-Log "saveId: $saveId"
        Write-Log "characterId: $characterId"
    }
    if ($responseData.data) {
        $replyPreview = ($responseData.data | ConvertTo-Json -Depth 3 -Compress)
        if ($replyPreview.Length -gt 200) { $replyPreview = $replyPreview.Substring(0, 200) + "..." }
        Write-Log "Reply preview: $replyPreview"
    }

    # Write full response to a separate detailed log
    $detailLogFile = Join-Path $LogDir "quick-init-${LogTimestamp}-response.json"
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
    Write-Log "===== dev-quick-init.ps1 END ====="
    Write-Host "Log saved to: $LogFile" -ForegroundColor Cyan
}
