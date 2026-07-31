#Requires -Version 7.0
param(
    [string]$LogDir = "c:\Users\super\Documents\trae_projects\AGG-main\game_data\logs-backup",
    [string]$OutputDir = "c:\Users\super\Documents\trae_projects\AGG-main\docs\debug"
)

$ErrorActionPreference = "Continue"
$outputFile = Join-Path $OutputDir "bug-extract-select-option-mismatch.md"

if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

$cf = "``````"  # code fence
$sb = [System.Text.StringBuilder]::new()

[void]$sb.AppendLine("# Bug Extract: select_option Mismatch")
[void]$sb.AppendLine("")
[void]$sb.AppendLine("## Bug Description")
[void]$sb.AppendLine("- **User selected**: 检查口袋里的匿名信，再次阅读上面的内容")
[void]$sb.AppendLine("- **Game responded**: 你抬手敲了敲门")
[void]$sb.AppendLine("- **Expected**: Game should respond to reading the letter, not knocking on the door")
[void]$sb.AppendLine("")

# 1. Session Log
[void]$sb.AppendLine("## 1. Session Log - Chat/Select Events")
[void]$sb.AppendLine("")

$sessionLog = Join-Path $LogDir "session.log"
if (Test-Path $sessionLog) {
    $keywords = @("select_option", "ui_interaction", "processMessage", "intentHint", "action", "preprocessAction")
    $lines = Get-Content $sessionLog -Encoding UTF8 | Where-Object {
        $line = $_
        foreach ($kw in $keywords) {
            if ($line -match [regex]::Escape($kw)) { return $true }
        }
        return $false
    }
    
    [void]$sb.AppendLine("### Filtered lines (keywords: $($keywords -join ', '))")
    [void]$sb.AppendLine($cf)
    $lineCount = 0
    foreach ($line in $lines) {
        if ($lineCount -lt 200) {
            [void]$sb.AppendLine($line)
            $lineCount++
        }
    }
    [void]$sb.AppendLine($cf)
    [void]$sb.AppendLine("*Total matching lines: $($lines.Count), showing first 200*")
    [void]$sb.AppendLine("")
}

# 2. AI Log - LLM I/O
[void]$sb.AppendLine("## 2. AI Log - LLM Input/Output")
[void]$sb.AppendLine("")

$aiLog = Join-Path $LogDir "ai-2026-06-10.log"
if (Test-Path $aiLog) {
    $relevantLines = [System.Collections.Generic.List[string]]::new()
    $allLines = Get-Content $aiLog -Encoding UTF8
    
    for ($i = 0; $i -lt $allLines.Count; $i++) {
        $line = $allLines[$i]
        if ($line -match "LLM-OUTPUT" -and ($line -match "select_option" -or $line -match "ui_interaction")) {
            $relevantLines.Add("LINE $i : $line")
        }
        if ($line -match "LLM-INPUT" -and ($line -match "select_option" -or $line -match "ui_interaction")) {
            $relevantLines.Add("LINE $i : $line")
        }
    }
    
    [void]$sb.AppendLine("### LLM I/O lines mentioning select_option or ui_interaction")
    [void]$sb.AppendLine($cf)
    foreach ($line in $relevantLines) {
        if ($line.Length -gt 5000) {
            [void]$sb.AppendLine($line.Substring(0, 5000) + "... [TRUNCATED]")
        } else {
            [void]$sb.AppendLine($line)
        }
    }
    [void]$sb.AppendLine($cf)
    [void]$sb.AppendLine("*Total matching lines: $($relevantLines.Count)*")
    [void]$sb.AppendLine("")
}

# 3. Frontend Log
[void]$sb.AppendLine("## 3. Frontend Log - User Actions")
[void]$sb.AppendLine("")

$frontendLog = Join-Path $LogDir "frontend-2026-06-10.log"
if (Test-Path $frontendLog) {
    $keywords = @("select_option", "ui_interaction", "sendMessage", "chat")
    $lines = Get-Content $frontendLog -Encoding UTF8 | Where-Object {
        $line = $_
        foreach ($kw in $keywords) {
            if ($line -match [regex]::Escape($kw)) { return $true }
        }
        return $false
    }
    
    [void]$sb.AppendLine("### Filtered lines")
    [void]$sb.AppendLine($cf)
    foreach ($line in $lines) {
        if ($line.Length -gt 3000) {
            [void]$sb.AppendLine($line.Substring(0, 3000) + "... [TRUNCATED]")
        } else {
            [void]$sb.AppendLine($line)
        }
    }
    [void]$sb.AppendLine($cf)
    [void]$sb.AppendLine("")
}

# 4. System Log
[void]$sb.AppendLine("## 4. System Log - Message Processing")
[void]$sb.AppendLine("")

$systemLog = Join-Path $LogDir "system-2026-06-10.log"
if (Test-Path $systemLog) {
    $keywords = @("select_option", "ui_interaction", "processMessage", "intentHint", "preprocessAction")
    $lines = Get-Content $systemLog -Encoding UTF8 | Where-Object {
        $line = $_
        foreach ($kw in $keywords) {
            if ($line -match [regex]::Escape($kw)) { return $true }
        }
        return $false
    }
    
    [void]$sb.AppendLine("### Filtered lines")
    [void]$sb.AppendLine($cf)
    $lineCount = 0
    foreach ($line in $lines) {
        if ($lineCount -lt 200) {
            if ($line.Length -gt 3000) {
                [void]$sb.AppendLine($line.Substring(0, 3000) + "... [TRUNCATED]")
            } else {
                [void]$sb.AppendLine($line)
            }
            $lineCount++
        }
    }
    [void]$sb.AppendLine($cf)
    [void]$sb.AppendLine("*Total matching lines: $($lines.Count), showing first 200*")
    [void]$sb.AppendLine("")
}

# 5. Deep extract: Find user messages in LLM input that contain select_option
[void]$sb.AppendLine("## 5. Deep Extract: User Messages in LLM Input")
[void]$sb.AppendLine("")

if (Test-Path $aiLog) {
    $allLines = Get-Content $aiLog -Encoding UTF8
    $foundIndices = [System.Collections.Generic.List[int]]::new()
    
    for ($i = 0; $i -lt $allLines.Count; $i++) {
        $line = $allLines[$i]
        if ($line -match "LLM-INPUT" -and $line -match "select_option") {
            $foundIndices.Add($i)
        }
    }
    
    [void]$sb.AppendLine("### Found $($foundIndices.Count) LLM-INPUT lines with select_option")
    [void]$sb.AppendLine("")
    
    foreach ($idx in $foundIndices) {
        $line = $allLines[$idx]
        # Extract just the user messages from the JSON
        if ($line -match '"role":"user"') {
            # Find all user message content
            $userMsgs = [regex]::Matches($line, '"role":"user","content":"([^"]{0,2000})"')
            [void]$sb.AppendLine("#### Line $idx - User messages:")
            foreach ($m in $userMsgs) {
                [void]$sb.AppendLine("- $($m.Groups[1].Value)")
            }
            [void]$sb.AppendLine("")
        }
    }
}

# 6. Find LLM-OUTPUT lines that contain the wrong response
[void]$sb.AppendLine("## 6. LLM-OUTPUT with Key Phrases")
[void]$sb.AppendLine("")

if (Test-Path $aiLog) {
    $allLines = Get-Content $aiLog -Encoding UTF8
    
    for ($i = 0; $i -lt $allLines.Count; $i++) {
        $line = $allLines[$i]
        if ($line -match "LLM-OUTPUT" -and ($line -match "敲了敲门" -or $line -match "匿名信")) {
            [void]$sb.AppendLine("### Line $i")
            if ($line.Length -gt 5000) {
                [void]$sb.AppendLine($line.Substring(0, 5000) + "... [TRUNCATED]")
            } else {
                [void]$sb.AppendLine($line)
            }
            [void]$sb.AppendLine("")
        }
    }
}

# Write output
$sb.ToString() | Out-File -FilePath $outputFile -Encoding UTF8 -Force
Write-Host "Bug extract written to: $outputFile"
Write-Host "File size: $([math]::Round((Get-Item $outputFile).Length / 1KB, 2)) KB"
