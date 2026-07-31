#Requires -Version 7.0
$ErrorActionPreference = 'Continue'
$logPath = 'c:\Users\super\Documents\trae_projects\AGG-main\game_data\logs\session.log'
$lines = Get-Content $logPath -Encoding UTF8

# 查找 NPC 创建/失败相关
Write-Host "=== NPC creation/equip related events ==="
$lines | Where-Object { $_ -match '村长艾德温|铁匠加雷斯|NPC not found|create.*npc|npc.*create|spawn.*npc' } | ForEach-Object {
  try {
    $o = $_ | ConvertFrom-Json
    $dataStr = if ($o.data) { ($o.data | ConvertTo-Json -Compress -Depth 3) } else { '' }
    if ($dataStr.Length -gt 250) { $dataStr = $dataStr.Substring(0, 250) + '...' }
    Write-Host ("{0} | {1} | {2} | data={3}" -f $o.timestamp, $o.source, $o.message, $dataStr)
  } catch {
    Write-Host "PARSE_FAIL: $($_.Substring(0, [Math]::Min(150, $_.Length)))"
  }
}

Write-Host ""
Write-Host "=== AGENT-END summary ==="
$lines | Where-Object { $_ -match 'AGENT-END|completed,' -or $_ -match 'reached max iterations' } | ForEach-Object {
  try {
    $o = $_ | ConvertFrom-Json
    $iter = $o.data.iterations
    $tools = $o.data.toolCallsExecuted
    $finish = $o.data.finishReason
    $elapsed = $o.data.elapsed
    Write-Host ("{0} | {1} | {2} | iter={3} tools={4} finish={5} elapsed={6}" -f $o.timestamp, $o.data.agent, $o.message, $iter, $tools, $finish, $elapsed)
  } catch {
    Write-Host "PARSE_FAIL: $($_.Substring(0, [Math]::Min(150, $_.Length)))"
  }
}

Write-Host ""
Write-Host "=== batch_spawn and init flow ==="
$lines | Where-Object { $_ -match 'batch_spawn|spawn_agents|initialize|init.*complete|init.*fail|POST /api/v1/game' } | ForEach-Object {
  try {
    $o = $_ | ConvertFrom-Json
    $dataStr = if ($o.data) { ($o.data | ConvertTo-Json -Compress -Depth 3) } else { '' }
    if ($dataStr.Length -gt 250) { $dataStr = $dataStr.Substring(0, 250) + '...' }
    Write-Host ("{0} | {1} | {2} | data={3}" -f $o.timestamp, $o.source, $o.message, $dataStr)
  } catch {
    Write-Host "PARSE_FAIL: $($_.Substring(0, [Math]::Min(150, $_.Length)))"
  }
}
